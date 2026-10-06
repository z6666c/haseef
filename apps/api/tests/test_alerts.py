import unittest
from datetime import date, datetime, timezone

from haseef.domain.alerts import (
    AlertTarget, DispatchKey, OrgAlertContext, Recipient,
    TEMPLATE_LICENSE_EXPIRED, TEMPLATE_LICENSE_EXPIRING, TEMPLATE_POLICY_REVIEW,
    current_threshold, plan_dispatches, send_time_for,
)
from haseef.domain.arabic import count_days, due_phrase, normalize_digits

TODAY = date(2026, 10, 1)
NIGHT = datetime(2026, 9, 30, 22, 0, tzinfo=timezone.utc)   # 01:00 بتوقيت الرياض

ORG = "org-1"
CTX = {ORG: OrgAlertContext(subscription_active=True)}
AHMAD = Recipient("u1", "أحمد", "a@x.sa", "+966500000001")


def target(days_left: int, **kw) -> AlertTarget:
    from datetime import timedelta
    return AlertTarget(
        org_id=ORG, org_name="شركة النخبة", target_type=kw.pop("target_type", "COMPLIANCE_ITEM"),
        target_id=kw.pop("target_id", "item-1"), title="السجل التجاري",
        due_date=TODAY + timedelta(days=days_left), **kw,
    )


def plan(targets, already=None, ctx=CTX, recipients=None):
    return plan_dispatches(
        today=TODAY, now=NIGHT, targets=targets,
        recipients_by_org={ORG: recipients or [AHMAD]},
        org_context=ctx, already_dispatched=already if already is not None else set(),
    )


class ArabicTests(unittest.TestCase):
    def test_count_agreement(self):
        cases = {1: "يوم واحد", 2: "يومين", 3: "3 أيام", 10: "10 أيام", 11: "11 يوماً",
                 14: "14 يوماً", 60: "60 يوماً", 100: "100 يوم", 103: "103 أيام", 115: "115 يوماً"}
        for n, expected in cases.items():
            self.assertEqual(count_days(n), expected, n)

    def test_due_phrase(self):
        self.assertEqual(due_phrase(0), "اليوم")
        self.assertEqual(due_phrase(7), "خلال 7 أيام")
        self.assertEqual(due_phrase(-1), "منذ يوم واحد")

    def test_normalize_digits(self):
        self.assertEqual(normalize_digits("٠٥٥١٢٣"), "055123")


class ThresholdTests(unittest.TestCase):
    def test_crossing_not_equality(self):
        # 13 يوماً متبقية: العتبة 14 عُبرت (الشرط القديم بالمساواة كان سيُفوّتها)
        self.assertEqual(current_threshold(13, (60, 30, 14, 7)), 14)

    def test_not_yet(self):
        self.assertIsNone(current_threshold(61, (60, 30)))

    def test_overdue_maps_to_zero(self):
        self.assertEqual(current_threshold(-5, (60, 30, 0)), 0)


class PlanTests(unittest.TestCase):
    def test_sends_once_per_threshold_and_channel(self):
        out = plan([target(14)])
        self.assertEqual({d.key.channel for d in out}, {"WHATSAPP", "EMAIL"})
        self.assertTrue(all(d.key.threshold_days == 14 for d in out))
        self.assertEqual(out[0].template, TEMPLATE_LICENSE_EXPIRING)
        self.assertEqual(out[0].variables[3], "خلال 14 يوماً")

    def test_no_burst_when_many_thresholds_crossed(self):
        # عنصر أُضيف قبل انتهائه بـ 5 أيام: تنبيه واحد للعتبة 7 فقط، لا 60/30/14/7
        out = plan([target(5)], recipients=[Recipient("u1", "أحمد", None, "+966500000001", ("WHATSAPP",))])
        self.assertEqual(len(out), 1)
        self.assertEqual(out[0].key.threshold_days, 7)
        self.assertEqual(out[0].variables[3], "خلال 5 أيام")

    def test_idempotent_across_runs(self):
        already: set[DispatchKey] = set()
        first = plan([target(14)], already)
        second = plan([target(14)], already)
        self.assertEqual(len(first), 2)
        self.assertEqual(second, [])

    def test_missed_day_still_alerts(self):
        # المهمة تعطّلت يوم كان المتبقي 14؛ اليوم 13 → ما زال يُرسل تنبيه العتبة 14
        out = plan([target(13)])
        self.assertTrue(out and out[0].key.threshold_days == 14)

    def test_renewal_starts_new_cycle(self):
        already: set[DispatchKey] = set()
        plan([target(7)], already)
        renewed = target(7 + 365)        # نفس العنصر بتاريخ انتهاء جديد
        self.assertEqual(plan([renewed], already), [])          # بعيد عن أي عتبة
        from datetime import timedelta
        later = AlertTarget(**{**renewed.__dict__})
        # بعد سنة تقريباً تقترب العتبة 7 مجدداً للتاريخ الجديد
        out = plan_dispatches(today=renewed.due_date - timedelta(days=7), now=NIGHT, targets=[later],
                              recipients_by_org={ORG: [AHMAD]}, org_context=CTX, already_dispatched=already)
        self.assertEqual(len(out), 2)

    def test_expired_template(self):
        out = plan([target(-3)])
        self.assertEqual(out[0].template, TEMPLATE_LICENSE_EXPIRED)
        self.assertEqual(out[0].variables[3], "منذ 3 أيام")

    def test_policy_template(self):
        out = plan([target(30, target_type="POLICY", target_id="pol-1")])
        self.assertEqual(out[0].template, TEMPLATE_POLICY_REVIEW)

    def test_labor_template(self):
        for tt in ("IQAMA", "LABOR_TASK"):
            out = plan([target(-1, target_type=tt, target_id=f"{tt}-1")])
            self.assertEqual(out[0].template, "haseef_labor_due")

    def test_inactive_subscription_skips(self):
        self.assertEqual(plan([target(1)], ctx={ORG: OrgAlertContext(subscription_active=False)}), [])

    def test_disabled_rule_skips(self):
        self.assertEqual(plan([target(1, enabled=False)]), [])

    def test_missing_phone_falls_back_to_email_only(self):
        out = plan([target(1)], recipients=[Recipient("u1", "أحمد", "a@x.sa", None)])
        self.assertEqual([d.key.channel for d in out], ["EMAIL"])

    def test_whatsapp_quota(self):
        ctx = {ORG: OrgAlertContext(subscription_active=True, whatsapp_quota_remaining=1)}
        out = plan([target(1, target_id="a"), target(1, target_id="b")], ctx=ctx,
                   recipients=[Recipient("u1", "أحمد", None, "+966500000001", ("WHATSAPP",))])
        self.assertEqual([d.status for d in out], ["QUEUED", "SKIPPED"])
        self.assertEqual(out[1].skip_reason, "WHATSAPP_QUOTA_EXCEEDED")


class SendTimeTests(unittest.TestCase):
    def test_night_planning_sends_at_nine_riyadh(self):
        t = send_time_for(TODAY, NIGHT)
        self.assertEqual(t, datetime(2026, 10, 1, 6, 0, tzinfo=timezone.utc))   # 09:00 الرياض

    def test_late_run_sends_now(self):
        noon = datetime(2026, 10, 1, 9, 0, tzinfo=timezone.utc)   # 12:00 الرياض
        self.assertEqual(send_time_for(TODAY, noon), noon)


if __name__ == "__main__":
    unittest.main()
