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
from fastapi import Depends, Header, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import Connection, text

from .db import platform_tx, tenant_tx
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


def get_principal(creds: HTTPAuthorizationCredentials | None = Depends(_bearer)) -> Principal:
    if creds is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "يلزم تسجيل الدخول")
    try:
        claims = decode_token(creds.credentials)
    except jwt.PyJWTError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "جلسة غير صالحة أو منتهية")
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
        yield Tenant(principal=principal, org_id=x_org_id, role=role, conn=conn)


def get_platform_admin(principal: Principal = Depends(get_principal)) -> Iterator[Connection]:
    if not principal.is_platform_admin:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "هذه الواجهة لفريق حصيف فقط")
    with platform_tx() as conn:
        # التوكن قد يكون صدر قبل سحب الصلاحية؛ نتحقق من قاعدة البيانات في كل طلب.
        still_admin = conn.execute(
            text("SELECT is_platform_admin AND is_active FROM users WHERE id = :u"),
            {"u": principal.user_id},
        ).scalar_one_or_none()
        if not still_admin:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "هذه الواجهة لفريق حصيف فقط")
        yield conn


WRITERS = ("ORG_ADMIN", "COMPLIANCE_OFFICER", "DPO")
