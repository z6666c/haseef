"""فحص هيكل الحوكمة مقابل المعايير — منطق نقي بلا قاعدة بيانات (قابل للاختبار).

كل معيار يحمل قاعدة {"check": ...}. النتيجة لكل معيار: PASS أو FAIL أو NA مع رسالة توضح السبب
وما المطلوب. درجة الهيكل = نسبة المعايير *الإلزامية* المستوفاة موزونة بالخطورة؛ المعايير
الاسترشادية تُعرض ولا تخصم.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from datetime import date

SEVERITY_WEIGHT = {"critical": 3, "high": 2, "medium": 1}


@dataclass
class Member:
    full_name: str
    position: str = "MEMBER"
    is_independent: bool = False
    is_executive: bool = False
    term_ends_on: date | None = None


@dataclass
class Body:
    body_type: str
    name: str
    members: list[Member] = field(default_factory=list)


@dataclass
class OrgContext:
    legal_type: str
    size: str | None
    profile: dict
    bodies: list[Body]
    active_policy_types: set[str]
    ropa_count: int
    doa_count: int
    today: date


@dataclass
class CheckResult:
    code: str
    status: str            # PASS | FAIL | NA
    message: str
    level: str
    severity: str
    title: str
    domain: str

    def as_dict(self) -> dict:
        return self.__dict__.copy()


def _months_between(a: date, b: date) -> int:
    return (b.year - a.year) * 12 + (b.month - a.month) - (1 if b.day < a.day else 0)


def _bodies(ctx: OrgContext, *types: str) -> list[Body]:
    return [b for b in ctx.bodies if b.body_type in types]


def _board(ctx: OrgContext) -> Body | None:
    boards = _bodies(ctx, "BOARD")
    return boards[0] if boards else None


def _evaluate_rule(rule: dict, ctx: OrgContext) -> tuple[str, str]:
    """يرجع (الحالة، الرسالة)."""
    kind = rule["check"]

    if rule.get("requires_personal_data") and not ctx.profile.get("processes_personal_data", True):
        return "NA", "المنشأة لا تعالج بيانات شخصية حسب ملفها."

    if kind == "body_exists":
        found = _bodies(ctx, *rule["types"])
        if not found:
            return "FAIL", "لم يُضف هذا الجهاز إلى الهيكل بعد."
        need = rule.get("min_members", 0)
        if need and not any(len(b.members) >= need for b in found):
            return "FAIL", f"الجهاز موجود لكن لم يُسجَّل فيه {'عضو' if need == 1 else str(need) + ' أعضاء'}."
        return "PASS", "موجود في الهيكل."

    if kind == "body_or_position":
        if _bodies(ctx, *rule["types"]):
            return "PASS", "موجود في الهيكل."
        for b in _bodies(ctx, rule["body"]):
            if any(m.position == rule["position"] for m in b.members):
                return "PASS", "محدد ضمن أعضاء الجهاز."
        return "FAIL", "لم يُحدَّد بعد."

    if kind == "board_min_members":
        board = _board(ctx)
        if board is None:
            return "FAIL", "لا يوجد مجلس إدارة في الهيكل."
        n = len(board.members)
        return ("PASS", f"عدد الأعضاء {n}.") if n >= rule["min"] else ("FAIL", f"عدد الأعضاء {n} والحد الأدنى {rule['min']}.")

    if kind == "has_position":
        for b in _bodies(ctx, rule["body"]):
            if any(m.position == rule["position"] for m in b.members):
                return "PASS", "محدد."
        return "FAIL", "لم يُحدَّد بعد."

    if kind == "independent_min":
        board = _board(ctx)
        if board is None or not board.members:
            return "FAIL", "لا يوجد مجلس إدارة بأعضاء مسجلين."
        n = len(board.members)
        need = max(rule.get("min", 0), math.ceil(n * rule.get("ratio", 0)))
        have = sum(m.is_independent for m in board.members)
        return ("PASS", f"المستقلون {have} من {n}.") if have >= need else ("FAIL", f"المستقلون {have} والمطلوب {need} على الأقل.")

    if kind == "majority_non_exec":
        board = _board(ctx)
        if board is None or not board.members:
            return "FAIL", "لا يوجد مجلس إدارة بأعضاء مسجلين."
        non_exec = sum(not m.is_executive for m in board.members)
        return ("PASS", f"غير التنفيذيين {non_exec} من {len(board.members)}.") if non_exec * 2 > len(board.members) \
            else ("FAIL", f"غير التنفيذيين {non_exec} فقط من {len(board.members)}.")

    if kind == "chair_non_exec":
        board = _board(ctx)
        chair = next((m for m in (board.members if board else []) if m.position == "CHAIR"), None)
        if chair is None:
            return "FAIL", "لم يُحدَّد رئيس المجلس."
        return ("FAIL", f"الرئيس ({chair.full_name}) مسجل عضواً تنفيذياً.") if chair.is_executive else ("PASS", "الرئيس غير تنفيذي.")

    if kind == "committee":
        found = _bodies(ctx, rule["type"])
        if not found:
            return "FAIL", "اللجنة غير موجودة في الهيكل."
        c = found[0]
        if len(c.members) < rule["min"]:
            return "FAIL", f"أعضاء اللجنة {len(c.members)} والحد الأدنى {rule['min']}."
        if rule.get("no_executives") and any(m.is_executive for m in c.members):
            return "FAIL", "في اللجنة عضو تنفيذي."
        return "PASS", f"اللجنة مشكلة من {len(c.members)} أعضاء."

    if kind == "terms_valid":
        expired = [m.full_name for b in ctx.bodies for m in b.members if m.term_ends_on and m.term_ends_on < ctx.today]
        if expired:
            names = "، ".join(expired[:3]) + ("…" if len(expired) > 3 else "")
            return "FAIL", f"انتهت مدة عضوية: {names}."
        return "PASS", "لا توجد عضويات منتهية."

    if kind == "profile_field":
        if ctx.size and ctx.size in rule.get("exempt_sizes", []):
            return "NA", "المنشأة ضمن الفئات المعفاة حسب حجمها."
        v = ctx.profile.get(rule["field"])
        return ("PASS", "مستوفى.") if v else ("FAIL", "غير مسجل في ملف الحوكمة.")

    if kind == "profile_recent":
        v = ctx.profile.get(rule["field"])
        if not v:
            return "FAIL", "لم يُسجَّل التاريخ في ملف الحوكمة."
        m = _months_between(v, ctx.today)
        return ("PASS", f"آخر مرة قبل {m} شهراً.") if m <= rule["months"] else ("FAIL", f"آخر مرة قبل {m} شهراً.")

    if kind == "policy_active":
        return ("PASS", "سياسة معتمدة وسارية.") if rule["policy_type"] in ctx.active_policy_types \
            else ("FAIL", "لا توجد سياسة معتمدة من هذا النوع.")

    if kind == "ropa_exists":
        return ("PASS", f"{ctx.ropa_count} نشاط معالجة موثق.") if ctx.ropa_count else ("FAIL", "لم يُوثَّق أي نشاط معالجة.")

    if kind == "doa_exists":
        return ("PASS", f"{ctx.doa_count} صلاحية معتمدة.") if ctx.doa_count else ("FAIL", "لا توجد صلاحيات معتمدة.")

    return "NA", "نوع فحص غير معروف."


def run_check(standards: list[dict], ctx: OrgContext) -> tuple[list[CheckResult], float | None]:
    results: list[CheckResult] = []
    for s in standards:
        applies = s.get("applies_legal_types") or []
        if applies and ctx.legal_type not in applies:
            continue
        status, msg = _evaluate_rule(s["rule"], ctx)
        results.append(CheckResult(s["code"], status, msg, s["level"], s["severity"], s["title"], s["domain"]))

    mandatory = [r for r in results if r.level == "MANDATORY" and r.status != "NA"]
    if not mandatory:
        return results, None
    total = sum(SEVERITY_WEIGHT[r.severity] for r in mandatory)
    earned = sum(SEVERITY_WEIGHT[r.severity] for r in mandatory if r.status == "PASS")
    return results, round(100 * earned / total, 1)
