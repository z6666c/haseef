"""إنشاء أول مدير عام لغرفة العمليات في الإنتاج.

    python -m scripts.create_admin --email ops@haseef.sa --name "اسم المدير"

تُطبع كلمة مرور مؤقتة مرة واحدة ويُجبَر صاحبها على تغييرها عند أول دخول. يرفض التنفيذ إن وُجد
مدير عام فعّال، إلا مع --force (لاستعادة الوصول عند فقده).
"""

from __future__ import annotations

import argparse
import json
import re
import secrets
import sys

from sqlalchemy import text

from haseef.db import platform_tx
from haseef.security import hash_password


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--email", required=True)
    ap.add_argument("--name", required=True)
    ap.add_argument("--force", action="store_true")
    a = ap.parse_args()
    email = a.email.strip().lower()
    if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", email):
        print("البريد غير صحيح", file=sys.stderr)
        return 2
    pw = secrets.token_urlsafe(12)
    with platform_tx() as c:
        n = c.execute(text("SELECT count(*) FROM users WHERE platform_role = 'SUPER_ADMIN' AND is_active")).scalar_one()
        if n and not a.force:
            print(f"يوجد {n} مدير عام فعّال. أضف الأعضاء من غرفة العمليات، أو استخدم --force لاستعادة الوصول.", file=sys.stderr)
            return 1
        uid = c.execute(text("""
            INSERT INTO users (email, full_name, password_hash, must_change_password, is_platform_admin, platform_role)
            VALUES (:e, :n, :h, true, true, 'SUPER_ADMIN')
            ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, must_change_password = true,
                is_platform_admin = true, platform_role = 'SUPER_ADMIN', is_active = true
            RETURNING id"""), {"e": email, "n": a.name.strip(), "h": hash_password(pw)}).scalar_one()
        c.execute(text("""INSERT INTO audit_log (actor_user_id, action, entity_type, entity_id, changes)
                          VALUES (NULL, 'ADMIN_TEAM_ADD', 'user', :u, CAST(:c AS jsonb))"""),
                  {"u": uid, "c": json.dumps({"email": email, "role": "SUPER_ADMIN", "via": "create_admin"})})
    print(f"أُنشئ المدير العام: {email}")
    print(f"كلمة المرور المؤقتة (تظهر مرة واحدة): {pw}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
