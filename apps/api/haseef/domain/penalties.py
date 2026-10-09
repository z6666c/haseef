"""جدول الجزاءات وفق لائحة تنظيم العمل النموذجية (منطق نقي). مطابق لـ packages/shared/src/penalties.ts.

لكل مخالفة سطر بالمدة، ولكل تكرار (الأول حتى الرابع) جزاء: إنذار كتابي، أو نسبة/أيام من الأجر اليومي، أو إجراء فصل.
الجزاء يُضاف إلى حسم أجر مدة التأخر أو الغياب نفسها (أجر عن وقت لم يُعمل، وليس جزاءً).
  * التأخر: التكرار خلال نافذة تحددها المنشأة (الافتراضي 180 يوماً)، والمدة تُقاس من بداية الدوام.
  * الغياب دون إذن أو عذر: التكرار خلال السنة العقدية، والمدة بالأيام المتصلة.
  * المادة 80: الفصل دون مكافأة لغياب أكثر من 15 يوماً متصلة أو 30 متفرقة في السنة، بعد إنذار كتابي (بعد 10 أو 20 يوماً).
إرشاد عام وليس استشارة قانونية؛ تعتمد المنشأة لائحتها المعتمدة من الوزارة، وللموارد البشرية تعديل الجزاء قبل إصداره.
"""

from __future__ import annotations

W = "WARNING"
T80 = "TERMINATE_ART80"
TAW = "TERMINATE_WITH_AWARD"

# (تعطيل الآخرين؟) → جزاء كل تكرار: "WARNING" أو كسر/مضاعف الأجر اليومي
LATE = {
    "LATE_15": {False: [W, 0.05, 0.10, 0.20], True: [W, 0.15, 0.25, 0.50]},
    "LATE_30": {False: [0.10, 0.15, 0.25, 0.50], True: [0.25, 0.50, 0.75, 1.0]},
    "LATE_60": {False: [0.25, 0.50, 0.75, 1.0], True: [0.30, 0.50, 1.0, 2.0]},
    "LATE_OVER": {False: [W, 1.0, 2.0, 3.0], True: [W, 1.0, 2.0, 3.0]},
}
ABSENCE = {
    "ABS_1": [2.0, 3.0, 4.0, 5.0],
    "ABS_2_6": [2.0, 3.0, 4.0, 5.0],
    "ABS_7_10": [4.0, 5.0, 5.0, TAW],
    "ABS_11_14": [5.0, 5.0, T80, T80],
    "ABS_15": [T80, T80, T80, T80],
}
BRACKET_LABEL = {
    "LATE_15": "تأخر حتى 15 دقيقة", "LATE_30": "تأخر من 16 إلى 30 دقيقة", "LATE_60": "تأخر من 31 إلى 60 دقيقة", "LATE_OVER": "تأخر أكثر من ساعة",
    "ABS_1": "غياب يوم دون إذن أو عذر", "ABS_2_6": "غياب من يومين إلى 6 أيام متصلة", "ABS_7_10": "غياب من 7 إلى 10 أيام متصلة",
    "ABS_11_14": "غياب من 11 إلى 14 يوماً متصلة", "ABS_15": "غياب أكثر من 15 يوماً متصلة",
}
ORDINAL = {1: "الأولى", 2: "الثانية", 3: "الثالثة", 4: "الرابعة"}


def late_bracket(minutes_from_start: int) -> str | None:
    if minutes_from_start <= 0:
        return None
    if minutes_from_start <= 15:
        return "LATE_15"
    if minutes_from_start <= 30:
        return "LATE_30"
    if minutes_from_start <= 60:
        return "LATE_60"
    return "LATE_OVER"


def absence_bracket(consecutive_days: int) -> str | None:
    if consecutive_days <= 0:
        return None
    if consecutive_days == 1:
        return "ABS_1"
    if consecutive_days <= 6:
        return "ABS_2_6"
    if consecutive_days <= 10:
        return "ABS_7_10"
    if consecutive_days <= 14:
        return "ABS_11_14"
    return "ABS_15"


def penalty(bracket: str, occurrence: int, *, disrupted: bool = False) -> str | float:
    """الجزاء المقرر للتكرار رقم occurrence (يُثبت على الرابع فما بعده)."""
    i = min(max(occurrence, 1), 4) - 1
    if bracket in LATE:
        return LATE[bracket][disrupted][i]
    return ABSENCE[bracket][i]


def describe(p: str | float) -> str:
    if p == W:
        return "إنذار كتابي"
    if p == T80:
        return "يحق الفصل وفق المادة 80 دون مكافأة بعد إنذار كتابي — قرار إداري خارج حصيف"
    if p == TAW:
        return "يحق الفصل مع المكافأة إن لم يتجاوز مجموع الغياب 30 يوماً — قرار إداري خارج حصيف"
    p = float(p)
    if p < 1:
        return f"حسم {round(p * 100)}% من الأجر اليومي"
    return "حسم أجر يوم" if p == 1 else "حسم أجر يومين" if p == 2 else f"حسم أجر {int(p) if p.is_integer() else p} أيام"


def suggest(bracket: str, occurrence: int, dwage: float, *, disrupted: bool = False) -> dict:
    """اقتراح الجزاء: نوعه (إنذار/جزاء مالي/إجراء فصل) ومبلغه ووصفه."""
    p = penalty(bracket, occurrence, disrupted=disrupted)
    base = {"bracket": bracket, "bracket_label": BRACKET_LABEL[bracket], "occurrence": occurrence,
            "occurrence_label": f"المرة {ORDINAL.get(occurrence, f'رقم {occurrence}')}", "label": describe(p)}
    if p == W:
        return {**base, "nature": "WARNING", "amount": 0.0}
    if p in (T80, TAW):
        return {**base, "nature": "ACTION", "amount": 0.0}
    return {**base, "nature": "PENALTY", "amount": round(dwage * float(p), 2), "days_equiv": float(p)}
