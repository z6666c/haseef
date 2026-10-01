"""بيانات تجريبية للتطوير: منشأتان، مستخدم لكل منهما، مستشار خارجي يخدم الاثنتين،
ومدير منصة. كلمات المرور تُطبع عند التشغيل ولا تُخزَّن في المستودع.

    python -m scripts.seed
"""

from __future__ import annotations

import secrets
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import text

from haseef.db import platform_tx
from haseef.security import hash_password
from haseef.services.score_service import recompute

TODAY = date.today()


def run() -> None:
    passwords: dict[str, str] = {}

    def user(conn, email: str, name: str, phone: str | None = None, role: str | None = None) -> str:
        pw = secrets.token_urlsafe(9)
        passwords[email] = pw
        return conn.execute(text("""
            INSERT INTO users (email, full_name, phone_number, password_hash, is_platform_admin, platform_role)
            VALUES (:e, :n, :p, :h, :a, :r)
            ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, must_change_password = false,
                is_active = true
            RETURNING id"""), {"e": email, "n": name, "p": phone, "h": hash_password(pw),
                               "a": role is not None, "r": role}).scalar_one()

    with platform_tx() as conn:
        orgs = {}
        for cr, name, industry, tier in [
            ("1010123456", "مؤسسة النخبة للمقاولات", "المقاولات", "PROFESSIONAL_GRC"),
            ("2050654321", "شركة واحة التقنية", "تقنية المعلومات", "ESSENTIAL"),
        ]:
            org_id = conn.execute(text("""
                INSERT INTO organizations (cr_number, name, entity_legal_type, industry_type, commercial_size)
                VALUES (:cr, :n, 'LLC', :i, 'SMALL')
                ON CONFLICT (cr_number) DO UPDATE SET name = EXCLUDED.name RETURNING id"""),
                {"cr": cr, "n": name, "i": industry}).scalar_one()
            orgs[name] = org_id
            conn.execute(text("UPDATE organizations SET is_active = true, suspended_at = NULL, suspension_reason = NULL WHERE id = :o"), {"o": org_id})
            conn.execute(text("DELETE FROM subscriptions WHERE org_id = :o"), {"o": org_id})
            conn.execute(text("""
                INSERT INTO subscriptions (org_id, plan_tier, billing_cycle, starts_at, ends_at)
                VALUES (:o, :t, 'MONTHLY', :s, :e)"""),
                {"o": org_id, "t": tier, "s": datetime.now(timezone.utc) - timedelta(days=10),
                 "e": datetime.now(timezone.utc) + timedelta(days=20)})

        nukhba, waha = orgs["مؤسسة النخبة للمقاولات"], orgs["شركة واحة التقنية"]
        ahmad = user(conn, "ahmad@nukhba.example", "أحمد العتيبي", "+966500000001")
        sara = user(conn, "sara@waha.example", "سارة القحطاني", "+966500000002")
        advisor = user(conn, "advisor@example.sa", "مكتب الامتثال الاستشاري")
        user(conn, "ops@haseef.sa", "فريق عمليات حصيف", role="SUPER_ADMIN")
        user(conn, "support@haseef.sa", "الدعم الفني", role="SUPPORT")
        user(conn, "billing@haseef.sa", "المحاسبة", role="BILLING")

        for org, uid, role in [(nukhba, ahmad, "ORG_ADMIN"), (waha, sara, "ORG_ADMIN"),
                               (nukhba, advisor, "EXTERNAL_ADVISOR"), (waha, advisor, "EXTERNAL_ADVISOR")]:
            conn.execute(text("""INSERT INTO memberships (org_id, user_id, role) VALUES (:o, :u, :r)
                                 ON CONFLICT (org_id, user_id) DO NOTHING"""), {"o": org, "u": uid, "r": role})

        conn.execute(text("DELETE FROM compliance_items WHERE org_id IN (:a, :b)"), {"a": nukhba, "b": waha})
        items = [
            (nukhba, "COMMERCIAL_REG", "السجل التجاري", 140, "CRITICAL", "https://mc.gov.sa"),
            (nukhba, "BALADY", "رخصة بلدي — الفرع الرئيسي", -2, "CRITICAL", "https://balady.gov.sa"),
            (nukhba, "CHI_INSURANCE", "التأمين الطبي للموظفين", 5, "HIGH", None),
            (nukhba, "CIVIL_DEFENSE", "شهادة الدفاع المدني", 13, "HIGH", "https://salamah.998.gov.sa"),
            (nukhba, "QIWA_NITAQAT", "شهادة السعودة", 75, "HIGH", "https://qiwa.sa"),
            (nukhba, "ZATCA", "شهادة الزكاة", 210, "HIGH", "https://zatca.gov.sa"),
            (waha, "COMMERCIAL_REG", "السجل التجاري", 25, "CRITICAL", "https://mc.gov.sa"),
            (waha, "GOSI", "شهادة التأمينات", 90, "HIGH", "https://gosi.gov.sa"),
        ]
        for org, cat, title, days, risk, url in items:
            conn.execute(text("""
                INSERT INTO compliance_items (org_id, category, title, expiry_date, risk_level, renewal_url)
                VALUES (:o, :c, :t, :d, :r, :u)"""),
                {"o": org, "c": cat, "t": title, "d": TODAY + timedelta(days=days), "r": risk, "u": url})

        conn.execute(text("DELETE FROM internal_policies WHERE org_id = :o"), {"o": nukhba})
        for ptype, title, days in [("CONFLICT_OF_INTEREST", "سياسة تعارض المصالح", 120),
                                   ("PRIVACY_POLICY", "سياسة الخصوصية", -10)]:
            conn.execute(text("""INSERT INTO internal_policies (org_id, policy_type, title, review_due_date)
                                 VALUES (:o, :p, :t, :d)"""),
                         {"o": nukhba, "p": ptype, "t": title, "d": TODAY + timedelta(days=days)})

    for org in (nukhba, waha):
        with platform_tx() as conn:
            recompute(conn, org)

    print("\nحسابات التطوير (تتغير كلمات المرور مع كل تشغيل):")
    for email, pw in passwords.items():
        print(f"  {email:<26} {pw}")


if __name__ == "__main__":
    run()
