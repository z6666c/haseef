from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import text

from ..db import platform_tx
from ..deps import Principal, get_principal, get_principal_allow_temp
from ..schemas import ChangePasswordIn, LoginIn, MeOut, MembershipOut, TokenOut
from ..security import hash_password, issue_token, needs_rehash, verify_password

router = APIRouter(prefix="/auth", tags=["auth"])

# تجزئة ثابتة لمقارنة وهمية عند عدم وجود المستخدم، حتى لا يكشف زمن الاستجابة وجود البريد.
_DUMMY_HASH = hash_password("timing-equaliser-not-a-real-password")


@router.post("/login", response_model=TokenOut)
def login(body: LoginIn) -> TokenOut:
    # تسجيل الدخول يسبق تحديد المنشأة، فيتم بدور المنصة.
    with platform_tx() as conn:
        user = conn.execute(
            text("SELECT id, password_hash, is_platform_admin, is_active, must_change_password FROM users WHERE email = :e"),
            {"e": body.email},
        ).mappings().one_or_none()
        ok = verify_password(user["password_hash"] if user else _DUMMY_HASH, body.password)
        if not (user and ok and user["is_active"]):
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "البريد أو كلمة المرور غير صحيحة")
        if needs_rehash(user["password_hash"]):
            conn.execute(text("UPDATE users SET password_hash=:h WHERE id=:id"),
                         {"h": hash_password(body.password), "id": user["id"]})
        conn.execute(text("UPDATE users SET last_login_at=now() WHERE id=:id"), {"id": user["id"]})
        conn.execute(text("""INSERT INTO audit_log (actor_user_id, action, entity_type, entity_id)
                             VALUES (:u, 'LOGIN', 'user', :u)"""), {"u": user["id"]})
    return TokenOut(access_token=issue_token(str(user["id"]), is_platform_admin=user["is_platform_admin"],
                                             must_change_password=user["must_change_password"]),
                    must_change_password=user["must_change_password"])


@router.post("/change-password", status_code=204)
def change_password(body: ChangePasswordIn, p: Principal = Depends(get_principal_allow_temp)):
    if body.new_password == body.current_password:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "كلمة المرور الجديدة يجب أن تختلف عن الحالية")
    with platform_tx() as conn:
        current = conn.execute(text("SELECT password_hash FROM users WHERE id = :u AND is_active"),
                               {"u": p.user_id}).scalar_one_or_none()
        if current is None or not verify_password(current, body.current_password):
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "كلمة المرور الحالية غير صحيحة")
        conn.execute(text("""UPDATE users SET password_hash = :h, must_change_password = false, password_changed_at = now()
                             WHERE id = :u"""), {"h": hash_password(body.new_password), "u": p.user_id})
        conn.execute(text("""INSERT INTO audit_log (actor_user_id, action, entity_type, entity_id)
                             VALUES (:u, 'CHANGE_PASSWORD', 'user', :u)"""), {"u": p.user_id})


@router.get("/me", response_model=MeOut)
def me(p: Principal = Depends(get_principal)) -> MeOut:
    # قائمة منشآت المستخدم عابرة للمستأجرين بطبيعتها؛ نقيّدها صراحةً بـ user_id.
    with platform_tx() as conn:
        u = conn.execute(text("SELECT id, email, full_name, is_platform_admin FROM users WHERE id=:id AND is_active"),
                         {"id": p.user_id}).mappings().one_or_none()
        if u is None:
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "الحساب غير فعّال")
        rows = conn.execute(text("""
            SELECT m.org_id, o.name AS org_name, o.cr_number, m.role FROM memberships m
            JOIN organizations o ON o.id = m.org_id
            WHERE m.user_id = :id AND m.is_active AND o.is_active ORDER BY o.name"""), {"id": p.user_id}).mappings()
        return MeOut(id=u["id"], email=u["email"], full_name=u["full_name"],
                     is_platform_admin=u["is_platform_admin"],
                     memberships=[MembershipOut(**r) for r in rows])
