"""صياغة العربية في الرسائل: تمييز العدد والتواريخ.

القالب القديم كان يقول "{{4}} يوماً" دائماً، فيخرج "خلال 3 يوماً" و"خلال 1 يوماً".
هنا تُبنى العبارة كاملة وتُمرَّر كمتغيّر واحد.
"""

from __future__ import annotations

from datetime import date

_ARABIC_INDIC = str.maketrans("٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹", "01234567890123456789")


def normalize_digits(text: str) -> str:
    """يحوّل الأرقام العربية-الهندية والفارسية إلى أرقام لاتينية."""
    return text.translate(_ARABIC_INDIC)


def count_days(n: int) -> str:
    """تمييز "يوم" حسب قواعد العدد العربي.

    1 → يوم واحد، 2 → يومين، 3–10 → أيام، 11–99 → يوماً،
    والمئات تعتمد على آخر رقمين (100 يوم، 103 أيام، 115 يوماً).
    """
    if n < 0:
        raise ValueError("count_days expects a non-negative number")
    if n == 1:
        return "يوم واحد"
    if n == 2:
        return "يومين"
    tail = n % 100
    if n >= 100 and tail in (0, 1, 2):
        return f"{n} يوم"
    if 3 <= tail <= 10:
        return f"{n} أيام"
    return f"{n} يوماً"


# تمييز العدد لأي اسم: (المفرد، المثنى، جمع القلة 3–10، المفرد المنصوب 11 فأكثر) — مطابق لـ countOf في الواجهة
NOUNS = {
    "يوم": ("يوم", "يومين", "أيام", "يوماً"), "موظف": ("موظف", "موظفَين", "موظفين", "موظفاً"),
    "دقيقة": ("دقيقة", "دقيقتين", "دقائق", "دقيقة"), "ساعة": ("ساعة", "ساعتين", "ساعات", "ساعة"),
    "شهر": ("شهر", "شهرين", "أشهر", "شهراً"), "سنة": ("سنة", "سنتين", "سنوات", "سنة"),
    "عضو": ("عضو", "عضوين", "أعضاء", "عضواً"), "منشأة": ("منشأة", "منشأتين", "منشآت", "منشأة"),
    "طلب": ("طلب", "طلبين", "طلبات", "طلباً"), "إشعار": ("إشعار", "إشعارين", "إشعارات", "إشعاراً"),
    "رسالة": ("رسالة", "رسالتين", "رسائل", "رسالة"), "قسط": ("قسط", "قسطين", "أقساط", "قسطاً"),
    "مرة": ("مرة", "مرتين", "مرات", "مرة"),
}
_ONE_FEM = {"دقيقة", "ساعة", "سنة", "منشأة", "رسالة", "مرة"}


def count_of(n: float, noun: str) -> str:
    """«يوم واحد»، «يومين»، «5 أيام»، «15 يوماً»، «100 يوم»، «2.5 يوم»."""
    one, two, few, many = NOUNS[noun]
    if not float(n).is_integer() or n == 0:
        return f"{int(n) if float(n).is_integer() else f'{n:.1f}'} {one}"
    n = int(n); a = abs(n)
    if a == 1:
        return f"{one} {'واحدة' if noun in _ONE_FEM else 'واحد'}"
    if a == 2:
        return two
    tail = a % 100
    if a >= 100 and tail <= 2:
        return f"{n} {one}"
    return f"{n} {few if 3 <= tail <= 10 else many}"


def count_points(n: int) -> str:
    """تمييز "نقطة": نقطة واحدة، نقطتان، 3–10 نقاط، 11+ نقطة."""
    if n < 0:
        raise ValueError("count_points expects a non-negative number")
    if n == 1:
        return "نقطة واحدة"
    if n == 2:
        return "نقطتان"
    tail = n % 100
    if 3 <= tail <= 10:
        return f"{n} نقاط"
    return f"{n} نقطة"


def count_members(n: int) -> str:
    """عضو واحد، عضوين، 3–10 أعضاء، 11+ عضواً."""
    if n == 1:
        return "عضو واحد"
    if n == 2:
        return "عضوين"
    return f"{n} أعضاء" if 3 <= n % 100 <= 10 else f"{n} عضواً"


def due_phrase(days_left: int) -> str:
    """العبارة التي تحل محل {{4}} في القالب.

    >>> due_phrase(0)
    'اليوم'
    >>> due_phrase(3)
    'خلال 3 أيام'
    >>> due_phrase(-2)
    'منذ يومين'
    """
    if days_left == 0:
        return "اليوم"
    if days_left > 0:
        return f"خلال {count_days(days_left)}"
    return f"منذ {count_days(-days_left)}"


def format_date(d: date) -> str:
    """تاريخ ميلادي بصيغة يوم/شهر/سنة كما هو مألوف في المنصات الحكومية."""
    return d.strftime("%d/%m/%Y")
