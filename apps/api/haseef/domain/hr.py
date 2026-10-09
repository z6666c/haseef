"""الإجازات والخصومات (منطق نقي). مطابق لـ packages/shared/src/hr.ts.

مراجع نظام العمل (للاسترشاد، وليست استشارة قانونية):
  * الإجازة السنوية: 21 يوماً، و30 يوماً إذا أمضى العامل خمس سنوات متصلة (المادة 109).
  * الغرامة عن المخالفة الواحدة لا تزيد على أجر خمسة أيام، ولا يُقتطع للغرامات أكثر من أجر خمسة أيام في الشهر.
  * لا يُتهم العامل بمخالفة مضى على كشفها أكثر من 30 يوماً، ويُبلّغ كتابة ويُسمع دفاعه قبل الجزاء.
  * مجموع الحسم من الأجر لا يتجاوز نصفه (المادة 92).
حسم أجر أيام الغياب أو التأخر عن المباشرة مقابل عمل لم يُؤدَّ، فلا يدخل في سقف الغرامات بل في سقف النصف فقط.
"""

from __future__ import annotations

from datetime import date, timedelta

LEAVE_TYPES = ("ANNUAL", "REGULAR", "EMERGENCY", "SICK")
LEAVE_LABEL = {"ANNUAL": "سنوية", "REGULAR": "اعتيادية", "EMERGENCY": "اضطرارية", "SICK": "مرضية"}
DEFAULT_POLICIES = {
    "ANNUAL":    {"pay_mode": "PAID",   "is_paid": True, "from_balance": True,  "max_days_per_request": None, "yearly_cap": None, "min_notice_days": 0},
    # الاعتيادية والاضطرارية: مدفوعة (من الرصيد السنوي) أو بدون أجر، يختار الموظف في كل طلب
    "REGULAR":   {"pay_mode": "CHOICE", "is_paid": True, "from_balance": True,  "max_days_per_request": 30,   "yearly_cap": None, "min_notice_days": 0},
    "EMERGENCY": {"pay_mode": "CHOICE", "is_paid": True, "from_balance": True,  "max_days_per_request": 3,    "yearly_cap": 5,    "min_notice_days": 0},
    # المادة 117: خلال السنة الواحدة 30 يوماً بأجر كامل، ثم 60 بثلاثة أرباع الأجر، ثم 30 دون أجر
    "SICK":      {"pay_mode": "PAID",   "is_paid": True, "from_balance": False, "max_days_per_request": None, "yearly_cap": 120,  "min_notice_days": 0},
}
SICK_TIERS = ((30, 1.0), (60, 0.75), (30, 0.0))
SICK_BACKDATE_DAYS = 7
KIND_LABEL = {"LATE": "تأخر عن الدوام", "ABSENCE": "غياب", "LATE_RETURN": "تأخر عن المباشرة بعد الإجازة",
              "VIOLATION": "مخالفة لائحة تنظيم العمل", "OTHER": "أخرى"}
FINE_KINDS = ("LATE", "VIOLATION", "OTHER")      # جزاءات تأديبية: سقف خمسة أيام ومهلة 30 يوماً
STATUS_LABEL = {"PENDING": "بانتظار القرار", "APPROVED": "موافق عليها", "REJECTED": "مرفوضة", "CANCELLED": "ملغاة",
                "ISSUED": "صادر", "OBJECTED": "معترض عليه", "CONFIRMED": "مؤكد", }


def weekday0(d: date) -> int:
    """0 = الأحد (مثل إعدادات الحضور)."""
    return (d.weekday() + 1) % 7


def annual_entitlement(start_date: date, on: date) -> int:
    years = on.year - start_date.year - ((on.month, on.day) < (start_date.month, start_date.day))
    return 30 if years >= 5 else 21


def holiday_dates(events: list[dict]) -> set[date]:
    out: set[date] = set()
    for e in events:
        if e.get("is_holiday") and e.get("is_active", True):
            out |= {e["event_date"] + timedelta(days=i) for i in range(max(int(e.get("holiday_days") or 1), 1))}
    return out


def count_days(start: date, end: date, *, work_days: list[int], holidays: set[date], workdays_only: bool) -> int:
    n, d = 0, start
    while d <= end:
        if not workdays_only or (weekday0(d) in work_days and d not in holidays):
            n += 1
        d += timedelta(days=1)
    return n


def late_return_days(end_date: date, return_date: date, *, work_days: list[int], holidays: set[date]) -> int:
    """أيام العمل بين اليوم التالي لنهاية الإجازة واليوم السابق للمباشرة."""
    if return_date <= end_date + timedelta(days=1):
        return 0
    return count_days(end_date + timedelta(days=1), return_date - timedelta(days=1), work_days=work_days, holidays=holidays, workdays_only=True)


PAY_MODES = ("PAID", "UNPAID", "CHOICE")
PAY_MODE_LABEL = {"PAID": "مدفوعة دائماً", "UNPAID": "بدون أجر دائماً", "CHOICE": "يختار الموظف: مدفوعة أو بدون أجر"}


def resolve_paid(policy: dict, requested: bool | None) -> bool:
    """أجر الطلب: يفرضه نوع الإجازة، أو يختاره مقدم الطلب إن كانت السياسة «حسب الاختيار» (الافتراضي مدفوعة)."""
    mode = policy.get("pay_mode") or ("PAID" if policy.get("is_paid", True) else "UNPAID")
    if mode == "PAID":
        return True
    if mode == "UNPAID":
        return False
    return True if requested is None else bool(requested)


def validate_leave(*, leave_type: str, start: date, end: date, days: int, today: date, policy: dict, by_hr: bool,
                   balance: float, used_this_year_type: int, is_paid: bool = True) -> str | None:
    if leave_type not in LEAVE_TYPES:
        return "نوع الإجازة غير معروف"
    if not policy.get("is_active", True):
        return f"الإجازة ال{LEAVE_LABEL[leave_type]} غير متاحة في منشأتك"
    if end < start:
        return "تاريخ النهاية قبل البداية"
    if (end - start).days > 365:
        return "مدة الإجازة طويلة جداً"
    if days <= 0:
        return "الفترة المختارة لا تتضمن أيام عمل"
    if not by_hr:
        earliest = (today - timedelta(days=3) if leave_type == "EMERGENCY" else today - timedelta(days=SICK_BACKDATE_DAYS) if leave_type == "SICK"
                    else today + timedelta(days=policy.get("min_notice_days") or 0))
        if start < earliest:
            return ("الإجازة الاضطرارية تُرفع خلال 3 أيام من بدايتها كحد أقصى" if leave_type == "EMERGENCY"
                    else f"الإجازة المرضية تُرفع خلال {SICK_BACKDATE_DAYS} أيام من بدايتها كحد أقصى" if leave_type == "SICK"
                    else f"يجب رفع الطلب قبل {policy.get('min_notice_days') or 0} يوم على الأقل" if policy.get("min_notice_days") else "لا يمكن رفع إجازة بتاريخ مضى")
    mx = policy.get("max_days_per_request")
    if mx and days > mx:
        return f"الحد الأقصى للطلب الواحد {mx} يوم"
    cap = policy.get("yearly_cap")
    if cap and used_this_year_type + days > cap:
        return f"تجاوزت الحد السنوي ({cap} يوم) لهذا النوع؛ المتبقي {max(cap - used_this_year_type, 0)}"
    if is_paid and policy.get("from_balance") and days > balance:
        return f"الرصيد غير كافٍ: المتبقي {fmt_days(balance)} يوم"
    return None


def sick_split(used_before: int, days: int) -> list[tuple[int, float]]:
    """توزيع أيام الإجازة المرضية على شرائح الأجر بحسب ما استُخدم قبلها في السنة: [(أيام، نسبة الأجر)]."""
    out, pos, left = [], 0, days
    for size, rate in SICK_TIERS:
        lo, hi = pos, pos + size
        take = max(0, min(hi, used_before + left) - max(lo, used_before))
        if take:
            out.append((take, rate))
        pos = hi
    rest = days - sum(t for t, _ in out)
    if rest > 0:
        out.append((rest, 0.0))
    return out


def sick_note(used_before: int, days: int) -> str:
    parts = {1.0: "بأجر كامل", 0.75: "بثلاثة أرباع الأجر", 0.0: "دون أجر"}
    return "، ".join(f"{d} يوم {parts[r]}" for d, r in sick_split(used_before, days))


def fmt_days(x: float) -> str:
    return str(int(x)) if float(x).is_integer() else f"{x:.1f}"


WAGE_BASES = ("BASIC", "BASIC_HOUSING", "TOTAL")
NATURES = ("WAGE", "PENALTY", "WARNING")
NATURE_LABEL = {"WAGE": "حسم أجر المدة", "PENALTY": "جزاء مالي", "WARNING": "إنذار كتابي"}


def daily_wage(basic: float, housing: float, other: float = 0, base: str = "TOTAL") -> float:
    """أجر اليوم = الأجر الشهري ÷ 30. الأجر الفعلي يشمل البدلات الثابتة (السكن والنقل وغيرها) ما لم تختر المنشأة غير ذلك."""
    monthly = float(basic) + (float(housing) if base in ("BASIC_HOUSING", "TOTAL") else 0) + (float(other or 0) if base == "TOTAL" else 0)
    return round(monthly / 30, 2)


def monthly_wage(basic: float, housing: float, other: float = 0) -> float:
    return round(float(basic) + float(housing) + float(other or 0), 2)


def late_amount(minutes: int, dwage: float, work_minutes: int) -> float:
    return round(dwage * minutes / max(work_minutes, 1), 2)


def nature_of(kind: str) -> str:
    """للإشعارات القديمة قبل التمييز بين حسم المدة والجزاء."""
    return "WAGE" if kind in ("ABSENCE", "LATE_RETURN") else "PENALTY"


def validate_deduction(*, kind: str, amount: float, incident: date, today: date, dwage: float, monthly_wage: float,
                       month_fines: float, month_total: float, nature: str | None = None) -> str | None:
    """الضوابط بحسب طبيعة الإشعار:
      * حسم أجر المدة (غياب/تأخر/تأخر عن المباشرة): أجر عن وقت لم يُعمل، يخضع لسقف نصف الأجر فقط.
      * الجزاء المالي: لا يتجاوز أجر خمسة أيام للمخالفة ولا مجموع الشهر، ولا يُوقَّع بعد 30 يوماً من الواقعة.
      * الإنذار الكتابي: بلا مبلغ، ومهلة الثلاثين يوماً نفسها.
    """
    nature = nature or nature_of(kind)
    if kind not in KIND_LABEL:
        return "نوع الخصم غير معروف"
    if nature not in NATURES:
        return "طبيعة الإشعار غير معروفة"
    if incident > today:
        return "تاريخ الواقعة في المستقبل"
    if nature == "WARNING":
        if amount:
            return "الإنذار الكتابي بلا مبلغ"
    elif amount <= 0:
        return "المبلغ يجب أن يكون أكبر من صفر"
    if nature in ("PENALTY", "WARNING") and (today - incident).days > 30:
        return "مضى أكثر من 30 يوماً على الواقعة؛ لا يجوز توقيع الجزاء نظاماً"
    cap5 = round(dwage * 5, 2)
    if nature == "PENALTY":
        if amount > cap5:
            return f"الجزاء عن المخالفة الواحدة لا يتجاوز أجر خمسة أيام ({cap5:.2f} ريال)"
        if month_fines + amount > cap5:
            return f"مجموع الجزاءات في الشهر لا يتجاوز أجر خمسة أيام ({cap5:.2f} ريال)؛ المتاح {max(cap5 - month_fines, 0):.2f}"
    half = round(monthly_wage / 2, 2)
    if amount and month_total + amount > half:
        return f"مجموع الحسم في الشهر لا يتجاوز نصف الأجر ({half:.2f} ريال)؛ المتاح {max(half - month_total, 0):.2f}"
    return None


# مرفقات الإجازة (التقرير الطبي): PDF أو صورة. النوع يُحدد من محتوى الملف لا من اسمه.
ATTACH_EXT = {"application/pdf": ".pdf", "image/jpeg": ".jpg", "image/png": ".png"}
ATTACH_MAX_BYTES = 6 * 1024 * 1024


def sniff_mime(data: bytes) -> str | None:
    if data.startswith(b"%PDF-"):
        return "application/pdf"
    if data.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    return None


def safe_file_name(name: str, mime: str) -> str:
    import re
    base = re.sub(r"[\\/\x00-\x1f<>:\"|?*]", "_", (name or "").strip())[:150] or "مرفق"
    ext = ATTACH_EXT[mime]
    return base if base.lower().endswith(ext) or (mime == "image/jpeg" and base.lower().endswith(".jpeg")) else base + ext
