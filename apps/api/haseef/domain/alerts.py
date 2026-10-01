"""تخطيط التنبيهات (منطق نقي بلا قاعدة بيانات).

الفروق عن الإصدار 1.0:
  * الشرط لم يعد مساواة (اليوم + العتبة = تاريخ الانتهاء)، بل "عبور العتبة":
    days_left <= threshold. إن تعطّلت المهمة يوماً لا يضيع التنبيه.
  * عند عبور عدة عتبات دفعة واحدة (عنصر أُضيف قبل انتهائه بـ 20 يوماً، أو توقف
    المهمة أسبوعاً) يُرسل تنبيه واحد للعتبة الأحدث فقط، لا وابل رسائل.
  * مفتاح عدم التكرار يتضمن due_date، فالتجديد (تغيّر تاريخ الانتهاء) يبدأ دورة جديدة.
  * التخطيط يحدث ليلاً، والإرسال يُجدول في ساعات النهار (09:00 بتوقيت الرياض افتراضياً).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta, timezone
from typing import Iterable
from zoneinfo import ZoneInfo

from .arabic import due_phrase, format_date

RIYADH = ZoneInfo("Asia/Riyadh")
DEFAULT_THRESHOLDS = (60, 30, 14, 7, 3, 1, 0)
DEFAULT_SEND_TIME = time(9, 0)

TEMPLATE_LICENSE_EXPIRING = "haseef_license_expiring"
TEMPLATE_LICENSE_EXPIRED = "haseef_license_expired"
TEMPLATE_POLICY_REVIEW = "haseef_policy_review_due"


@dataclass(frozen=True)
class AlertTarget:
    org_id: str
    org_name: str
    target_type: str            # 'COMPLIANCE_ITEM' | 'POLICY'
    target_id: str
    title: str
    due_date: date
    thresholds: tuple[int, ...] = DEFAULT_THRESHOLDS
    channels: tuple[str, ...] = ("WHATSAPP", "EMAIL")
    enabled: bool = True
    link: str | None = None


@dataclass(frozen=True)
class Recipient:
    user_id: str
    full_name: str
    email: str | None
    phone: str | None
    channels: tuple[str, ...] = ("WHATSAPP", "EMAIL")

    def address_for(self, channel: str) -> str | None:
        return self.phone if channel == "WHATSAPP" else self.email


@dataclass(frozen=True)
class DispatchKey:
    target_type: str
    target_id: str
    due_date: date
    threshold_days: int
    channel: str
    recipient_address: str


@dataclass
class PlannedDispatch:
    key: DispatchKey
    org_id: str
    recipient_user_id: str
    scheduled_for: datetime
    template: str
    variables: list[str]
    status: str = "QUEUED"
    skip_reason: str | None = None


@dataclass
class OrgAlertContext:
    subscription_active: bool
    whatsapp_quota_remaining: int | None = None   # None = غير محدود


def current_threshold(days_left: int, thresholds: Iterable[int]) -> int | None:
    """أصغر عتبة تم عبورها، أو None إن لم تُعبر أي عتبة بعد."""
    crossed = [t for t in thresholds if days_left <= t]
    return min(crossed) if crossed else None


def send_time_for(today: date, now: datetime, send_at: time = DEFAULT_SEND_TIME) -> datetime:
    """موعد الإرسال: الساعة المحددة من اليوم بتوقيت الرياض، أو الآن إن تجاوزناها."""
    planned = datetime.combine(today, send_at, tzinfo=RIYADH)
    return max(planned, now.astimezone(RIYADH)).astimezone(timezone.utc)


def render_template(t: AlertTarget, r: Recipient, days_left: int) -> tuple[str, list[str]]:
    if t.target_type == "POLICY":
        template = TEMPLATE_POLICY_REVIEW
    elif days_left < 0:
        template = TEMPLATE_LICENSE_EXPIRED
    else:
        template = TEMPLATE_LICENSE_EXPIRING
    # {{1}} الاسم، {{2}} العنصر، {{3}} المنشأة، {{4}} العبارة الزمنية، {{5}} التاريخ، {{6}} الرابط
    return template, [
        r.full_name,
        t.title,
        t.org_name,
        due_phrase(days_left),
        format_date(t.due_date),
        t.link or "https://app.haseef.sa",
    ]


def plan_dispatches(
    *,
    today: date,
    now: datetime,
    targets: Iterable[AlertTarget],
    recipients_by_org: dict[str, list[Recipient]],
    org_context: dict[str, OrgAlertContext],
    already_dispatched: set[DispatchKey],
    send_at: time = DEFAULT_SEND_TIME,
) -> list[PlannedDispatch]:
    """يُرجع التنبيهات الجديدة الواجب إدراجها في alert_dispatches.

    لا يُعيد ما سبق تسجيله (already_dispatched)، وقاعدة البيانات تحمي أيضاً
    بقيد UNIQUE في حال تزامن تشغيلين.
    """
    scheduled_for = send_time_for(today, now, send_at)
    planned: list[PlannedDispatch] = []
    wa_budget = {org: ctx.whatsapp_quota_remaining for org, ctx in org_context.items()}

    for t in targets:
        ctx = org_context.get(t.org_id)
        if not t.enabled or ctx is None or not ctx.subscription_active:
            continue
        days_left = (t.due_date - today).days
        threshold = current_threshold(days_left, t.thresholds)
        if threshold is None:
            continue

        for r in recipients_by_org.get(t.org_id, []):
            for channel in t.channels:
                if channel not in r.channels:
                    continue
                address = r.address_for(channel)
                if not address:
                    continue
                key = DispatchKey(t.target_type, t.target_id, t.due_date, threshold, channel, address)
                if key in already_dispatched:
                    continue
                template, variables = render_template(t, r, days_left)
                item = PlannedDispatch(
                    key=key,
                    org_id=t.org_id,
                    recipient_user_id=r.user_id,
                    scheduled_for=scheduled_for,
                    template=template,
                    variables=variables,
                )
                if channel == "WHATSAPP":
                    budget = wa_budget.get(t.org_id)
                    if budget is not None:
                        if budget <= 0:
                            item.status = "SKIPPED"
                            item.skip_reason = "WHATSAPP_QUOTA_EXCEEDED"
                        else:
                            wa_budget[t.org_id] = budget - 1
                planned.append(item)
                already_dispatched.add(key)
    return planned
