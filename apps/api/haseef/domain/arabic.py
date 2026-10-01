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
