"""اعتماديات FastAPI: هوية المستخدم وسياق المنشأة.

مسار كل طلب لعميل:
  1. التوكن ← user_id
  2. الترويسة X-Org-Id ← المنشأة المطلوبة
  3. تُفتح معاملة RLS بهذين القيمتين، ثم يُتحقق من العضوية *داخلها*:
     جدول memberships نفسه خاضع للعزل، فلا يُرجع صفاً إلا إن كان المستخدم عضواً.
"""

from __future__ import annotations

from collections.abc import Iterator
from dataclasses import dataclass
from uuid import UUID

import jwt
from fastapi import Depends, Header, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import Connection, text

from .db import platform_tx, tenant_tx
from .permissions import ALL as PERM_ALL, LABEL as PERM_LABEL, SUPER
from .security import decode_token

_bearer = HTTPBearer(auto_error=False)

ROLE_RANK = {"VIEWER": 0, "EXTERNAL_ADVISOR": 1, "DPO": 2, "COMPLIANCE_OFFICER": 2, "ORG_ADMIN": 3}


@dataclass(frozen=True)
class Principal:
    user_id: UUID
    is_platform_admin: bool


@dataclass(frozen=True)
class Tenant:
    principal: Principal
    org_id: UUID
    role: str
    conn: Connection

    def require(self, *roles: str) -> None:
        if self.role not in roles:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "صلاحيتك في هذه المنشأة لا تسمح بهذا الإجراء")


def _claims(creds: HTTPAuthorizationCredentials | None) -> dict:
    if creds is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "يلزم تسجيل الدخول")
    try:
        return decode_token(creds.credentials)
    except jwt.PyJWTError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "جلسة غير صالحة أو منتهية")


def get_principal(creds: HTTPAuthorizationCredentials | None = Depends(_bearer)) -> Principal:
    claims = _claims(creds)
    if claims.get("pwc"):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "يجب تغيير كلمة المرور المؤقتة أولاً")
    return Principal(user_id=UUID(claims["sub"]), is_platform_admin=bool(claims.get("adm")))


def get_principal_allow_temp(creds: HTTPAuthorizationCredentials | None = Depends(_bearer)) -> Principal:
    """لنقطة تغيير كلمة المرور فقط: تقبل التوكن المؤقت."""
    claims = _claims(creds)
    return Principal(user_id=UUID(claims["sub"]), is_platform_admin=bool(claims.get("adm")))


def get_tenant(
    principal: Principal = Depends(get_principal),
    x_org_id: UUID = Header(..., alias="X-Org-Id"),
) -> Iterator[Tenant]:
    with tenant_tx(x_org_id, principal.user_id) as conn:
        role = conn.execute(
            text("SELECT role FROM memberships WHERE user_id = :u AND is_active"),
            {"u": principal.user_id},
        ).scalar_one_or_none()
        if role is None:
            # لا نفرّق بين "منشأة غير موجودة" و"لست عضواً" حتى لا نكشف وجود المنشآت.
            raise HTTPException(status.HTTP_404_NOT_FOUND, "المنشأة غير موجودة")
        suspended = conn.execute(text("SELECT suspended_at IS NOT NULL OR NOT is_active FROM organizations")).scalar_one()
        if suspended:
            raise HTTPException(status.HTTP_423_LOCKED, "حساب المنشأة معلّق. تواصل مع فريق حصيف.")
        yield Tenant(principal=principal, org_id=x_org_id, role=role, conn=conn)


def get_platform_admin(principal: Principal = Depends(get_principal)) -> Iterator[Connection]:
    """أي عضو في فريق حصيف — للقراءة. الإجراءات تستخدم require_perm بصلاحية محددة."""
    if not principal.is_platform_admin:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "هذه الواجهة لفريق حصيف فقط")
    with platform_tx() as conn:
        # التوكن قد يكون صدر قبل سحب الصلاحية؛ نتحقق من قاعدة البيانات في كل طلب.
        still_admin = conn.execute(
            text("SELECT platform_role IS NOT NULL AND is_active FROM users WHERE id = :u"),
            {"u": principal.user_id},
        ).scalar_one_or_none()
        if not still_admin:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "هذه الواجهة لفريق حصيف فقط")
        yield conn


@dataclass(frozen=True)
class Admin:
    user_id: UUID
    role: str                    # رمز الدور (SUPER_ADMIN أو SUPPORT أو BILLING أو دور مخصص)
    role_name: str
    perms: frozenset
    conn: Connection
    ip: str | None

    @property
    def is_super(self) -> bool:
        return self.role == SUPER

    def can(self, *perms: str) -> bool:
        """يملك واحدة على الأقل من الصلاحيات المذكورة (المدير العام يملك الكل)."""
        return self.is_super or any(p in self.perms for p in perms)

    def audit(self, action: str, entity_type: str, entity_id=None, org_id=None, changes: dict | None = None) -> None:
        import json
        self.conn.execute(text("""
            INSERT INTO audit_log (org_id, actor_user_id, action, entity_type, entity_id, changes, ip_address)
            VALUES (:o, :u, :a, :t, :id, CAST(:c AS jsonb), CAST(:ip AS inet))"""),
            {"o": org_id, "u": self.user_id, "a": action, "t": entity_type, "id": entity_id,
             "c": json.dumps(changes, default=str, ensure_ascii=False) if changes else None, "ip": self.ip})


def require_perm(*perms: str, any_member: bool = False):
    """اعتمادية لإجراء إداري: يكفي امتلاك واحدة من الصلاحيات المذكورة. بلا صلاحيات = المدير العام فقط.
    any_member=True: أي عضو فعّال في الفريق (لنقطة "من أنا")."""
    unknown = set(perms) - PERM_ALL
    if unknown:
        raise RuntimeError(f"صلاحيات غير معرّفة: {unknown}")

    def dep(request: Request, principal: Principal = Depends(get_principal)) -> Iterator[Admin]:
        with platform_tx() as conn:
            row = conn.execute(text("""
                SELECT u.platform_role, u.is_active, r.name AS role_name, COALESCE(r.permissions, '{}') AS permissions
                FROM users u LEFT JOIN admin_roles r ON r.code = u.platform_role WHERE u.id = :u"""),
                {"u": principal.user_id}).mappings().one_or_none()
            if not row or not row["is_active"] or row["platform_role"] is None:
                raise HTTPException(status.HTTP_403_FORBIDDEN, "هذه الواجهة لفريق حصيف فقط")
            granted = PERM_ALL if row["platform_role"] == SUPER else frozenset(row["permissions"]) & PERM_ALL
            if perms and not (granted & set(perms)):
                names = "، ".join(PERM_LABEL[p] for p in perms)
                raise HTTPException(status.HTTP_403_FORBIDDEN, f"هذا الإجراء يتطلب صلاحية: {names}")
            if not perms and not any_member and row["platform_role"] != SUPER:
                raise HTTPException(status.HTTP_403_FORBIDDEN, "هذا الإجراء متاح للمدير العام فقط")
            yield Admin(principal.user_id, row["platform_role"], row["role_name"] or row["platform_role"], granted, conn,
                        request.client.host if request.client else None)

    return dep


WRITERS = ("ORG_ADMIN", "COMPLIANCE_OFFICER", "DPO")
