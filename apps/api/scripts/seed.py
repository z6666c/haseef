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
from haseef.content.examples import BODIES as EX_BODIES, PROFILE as EX_PROFILE
from haseef.services import governance_service as gs
from haseef.services.catalog_service import sync_catalog
from haseef.services.score_service import recompute  # noqa: F401

TODAY = date.today()


def run() -> None:
    from haseef.config import get_settings
    if get_settings().env == "production":
        raise SystemExit("seed.py لبيئة التطوير فقط: يضع كلمات مرور معروفة")
    passwords: dict[str, str] = {}

    def user(conn, email: str, name: str, phone: str | None = None, role: str | None = None,
             password: str | None = None) -> str:
        pw = password or secrets.token_urlsafe(9)
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
        # كلمتا مرور ثابتتان لبيئة التطوير فقط (طلب المالك): البريد + @ — لا تُستخدم في الإنتاج
        user(conn, "support@haseef.sa", "الدعم الفني", role="SUPPORT", password="support@haseef.sa@")
        user(conn, "billing@haseef.sa", "المحاسبة", role="BILLING", password="billing@haseef.sa@")

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

        # المحتوى المرجعي + هيكل الحوكمة والتزامات المنشأتين التجريبيتين
        sync_catalog(conn)
        for org in (nukhba, waha):
            conn.execute(text("DELETE FROM org_bodies WHERE org_id = :o"), {"o": org})
            conn.execute(text("DELETE FROM org_obligations WHERE org_id = :o"), {"o": org})
        # النخبة: مثال هيكلة متكامل (content/examples.py)؛ واحة: القالب الأساسي فقط
        gs.get_profile(conn, nukhba)
        sets = ", ".join(f"{k} = :{k}" for k in EX_PROFILE)
        conn.execute(text(f"UPDATE org_governance_profiles SET {sets}, template_applied_at = now() WHERE org_id = :o"),
                     {**EX_PROFILE, "o": nukhba})
        for i, (bt, name, mandate, meetings, members) in enumerate(EX_BODIES):
            bid = conn.execute(text("""INSERT INTO org_bodies (org_id, body_type, name, mandate, meetings_per_year, sort, from_template)
                                       VALUES (:o, :t, :n, :m, :mp, :s, true) RETURNING id"""),
                               {"o": nukhba, "t": bt, "n": name, "m": mandate, "mp": meetings, "s": (i + 1) * 10}).scalar_one()
            for full_name, pos, ind, exe, appointed, term in members:
                conn.execute(text("""INSERT INTO org_body_members (org_id, body_id, full_name, position, is_independent,
                                                                   is_executive, appointed_on, term_ends_on)
                                     VALUES (:o, :b, :n, :p, :i, :e, :a, :t)"""),
                             {"o": nukhba, "b": bid, "n": full_name, "p": pos, "i": ind, "e": exe, "a": appointed, "t": term})
        gs.apply_template(conn, waha)
        conn.execute(text("UPDATE org_governance_profiles SET employees_count = 6, vat_registered = false WHERE org_id = :o"), {"o": waha})
        for org in (nukhba, waha):
            gs.sync_obligations(conn, org)

        # حماية البيانات: طلبان من أصحاب البيانات وحادثة مغلقة (سجل الأنشطة يُترك فارغاً لتظهر الفجوة)
        conn.execute(text("DELETE FROM pdpl_requests WHERE org_id = :o"), {"o": nukhba})
        conn.execute(text("DELETE FROM pdpl_incidents WHERE org_id = :o"), {"o": nukhba})
        conn.execute(text("""INSERT INTO pdpl_requests (org_id, requester_name, requester_contact, request_type, channel, details,
                                                        received_on, due_on, status, identity_verified, response_note, completed_on)
                             VALUES (:o, 'محمد الغامدي', 'm.ghamdi@example.sa', 'ACCESS', 'EMAIL',
                                     'يطلب نسخة من بياناته المحفوظة لدى المنشأة بصفته عميلاً سابقاً.', :r1, :d1, 'IN_PROGRESS', true, NULL, NULL),
                                    (:o, 'عبدالله الشمري', '+966500000077', 'DESTRUCTION', 'PHONE',
                                     'متقدم سابق لوظيفة يطلب حذف سيرته الذاتية.', :r2, :d2, 'COMPLETED', true,
                                     'حُذفت السيرة من بريد التوظيف والأرشيف، وأُبلغ بذلك هاتفياً.', :c2)"""),
                     {"o": nukhba, "r1": TODAY - timedelta(days=22), "d1": TODAY + timedelta(days=8),
                      "r2": TODAY - timedelta(days=40), "d2": TODAY - timedelta(days=10), "c2": TODAY - timedelta(days=33)})
        disc = datetime.now(timezone.utc) - timedelta(days=60)
        conn.execute(text("""INSERT INTO pdpl_incidents (org_id, title, description, discovered_at, occurred_at, data_categories,
                                 subjects_affected, severity, harm_likely, status, authority_notified_at, subjects_notified_at,
                                 root_cause, actions_taken)
                             VALUES (:o, 'إرسال كشف رواتب لبريد خاطئ', 'أُرسل كشف رواتب شهر يوليو لعنوان بريد خارجي بالخطأ.',
                                     :disc, :occ, CAST(:cats AS jsonb), 18, 'MEDIUM', true, 'CLOSED', :notif, :subj,
                                     'إكمال تلقائي لعنوان البريد في برنامج البريد.',
                                     'طُلب من المستلم الحذف وأكّد كتابياً، أُبلغت الجهة المختصة والموظفون، وعُطّل الإكمال التلقائي وأصبح إرسال الكشوف عبر النظام فقط.')"""),
                     {"o": nukhba, "disc": disc, "occ": disc - timedelta(hours=3), "cats": '["الاسم", "الراتب", "الآيبان"]',
                      "notif": disc + timedelta(hours=30), "subj": disc + timedelta(hours=40)})

    for org in (nukhba, waha):
        with platform_tx() as conn:
            gs.run_and_save(conn, org, None)        # يعيد احتساب المؤشر أيضاً

    print("\nحسابات التطوير (تتغير كلمات المرور مع كل تشغيل):")
    for email, pw in passwords.items():
        print(f"  {email:<26} {pw}")


if __name__ == "__main__":
    run()
