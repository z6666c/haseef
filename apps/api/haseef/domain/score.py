"""مؤشر حصافة (Haseef Score).

الأوزان الأساسية كما في الوثيقة: 35% تشغيلي، 35% حوكمة و PDPL، 30% عقود ولوائح.
  * الركن يُحتسب فقط إن كان متاحاً في باقة المنشأة **ولديه بيانات**؛ ثم تُعاد موازنة الأوزان.
  * المنشأة بلا أي بيانات تحصل على None ("غير مُقيَّم") لا 100.
  * سقف للمخاطر الحرجة: عنصر حرج منتهٍ يحد المؤشر عند 50.
  * أسباب الخصم: كل سبب مع عدد النقاط التي يخصمها فعلاً من المؤشر النهائي، مرتبة
    من الأكبر أثراً، حتى يعرف العميل ما الذي يرفع مؤشره أولاً (دليل الهوية §3.2).
"""

from __future__ import annotations

from dataclasses import dataclass, field

from .arabic import count_points, due_phrase

BASE_WEIGHTS = {"OPERATIONAL": 35, "GOVERNANCE_PDPL": 35, "CONTRACTS": 30}
RISK_WEIGHT = {"CRITICAL": 3, "HIGH": 2, "MEDIUM": 1}
CRITICAL_EXPIRED_CAP = 50
EMERALD_THRESHOLD = 85      # دليل الهوية: 85% فما فوق = منشأة محصنة


@dataclass(frozen=True)
class ItemState:
    days_left: int
    risk_level: str = "HIGH"
    title: str = ""


@dataclass(frozen=True)
class PolicyState:
    days_left: int            # حتى موعد المراجعة
    title: str = ""
    policy_type: str = "OTHER"


@dataclass(frozen=True)
class RopaState:
    has_purpose: bool
    has_owner: bool
    cross_border_documented: bool = True   # False إن كان هناك نقل خارجي بلا توثيق


@dataclass
class ScoreInputs:
    plan_features: frozenset[str]
    items: list[ItemState] = field(default_factory=list)
    policies: list[PolicyState] = field(default_factory=list)
    ropa: list[RopaState] = field(default_factory=list)
    audit_percentages: list[int] = field(default_factory=list)  # أحدث تدقيق لكل وثيقة، آخر 12 شهراً
    # آخر فحص لهيكل الحوكمة: درجة المعايير الإلزامية، والمعايير غير المستوفاة (العنوان، الخطورة)
    structure_score: float | None = None
    structure_failures: list[tuple[str, str]] = field(default_factory=list)


@dataclass
class Reason:
    pillar: str
    severity: str           # 'critical' | 'high' | 'medium'
    text: str
    points: float = 0.0     # النقاط المخصومة من المؤشر النهائي

    def as_dict(self) -> dict:
        pts = round(self.points)
        return {"pillar": self.pillar, "severity": self.severity, "text": self.text,
                "points": pts, "points_label": count_points(pts) if pts > 0 else None}


@dataclass
class ScoreResult:
    score: int | None
    pillars: dict[str, float | None]
    weights_used: dict[str, float]
    capped: bool = False
    reasons: list[Reason] = field(default_factory=list)

    def as_dict(self) -> dict:
        return {
            "score": self.score,
            "pillars": self.pillars,
            "weights_used": self.weights_used,
            "capped_by_critical_expiry": self.capped,
            "reasons": [r.as_dict() for r in self.reasons],
        }


def item_credit(days_left: int) -> float:
    """رصيد العنصر حسب قربه من الانتهاء."""
    if days_left < 0:
        return 0.0
    if days_left <= 15:
        return 0.5
    if days_left <= 30:
        return 0.75
    return 1.0


def operational_pillar(items: list[ItemState]) -> float | None:
    if not items:
        return None
    total = sum(RISK_WEIGHT.get(i.risk_level, 2) for i in items)
    earned = sum(RISK_WEIGHT.get(i.risk_level, 2) * item_credit(i.days_left) for i in items)
    return 100 * earned / total


def _with_required_policies(policies: list[PolicyState], features: frozenset[str]) -> list[PolicyState]:
    """سياسة الخصوصية إلزامية لمن يملك ميزة PDPL: غيابها يُحتسب سياسة متأخرة."""
    if "PDPL" in features and policies and not any(p.policy_type == "PRIVACY_POLICY" for p in policies):
        return [*policies, PolicyState(days_left=-1, title="سياسة الخصوصية", policy_type="__MISSING_PRIVACY__")]
    return policies


def governance_parts(policies: list[PolicyState], ropa: list[RopaState], structure: float | None = None) -> list[float]:
    parts: list[float] = []
    if structure is not None:
        parts.append(structure)
    if policies:
        parts.append(100 * sum(1 for p in policies if p.days_left >= 0) / len(policies))
    if ropa:
        parts.append(100 * sum((r.has_purpose + r.has_owner + r.cross_border_documented) / 3 for r in ropa) / len(ropa))
    return parts


def governance_pillar(policies: list[PolicyState], ropa: list[RopaState], structure: float | None = None) -> float | None:
    parts = governance_parts(policies, ropa, structure)
    return sum(parts) / len(parts) if parts else None


def contracts_pillar(percentages: list[int]) -> float | None:
    return sum(percentages) / len(percentages) if percentages else None


def _reasons(inp: ScoreInputs, policies: list[PolicyState], weights: dict[str, float]) -> list[Reason]:
    """كل سبب = خسارته داخل ركنه × وزن الركن الفعلي، بالنقاط من 100."""
    out: list[Reason] = []

    if "OPERATIONAL" in weights:
        w = weights["OPERATIONAL"] / 100
        total = sum(RISK_WEIGHT.get(i.risk_level, 2) for i in inp.items)
        for i in inp.items:
            loss = RISK_WEIGHT.get(i.risk_level, 2) * (1 - item_credit(i.days_left)) / total * 100 * w
            if loss <= 0:
                continue
            sev = "critical" if i.days_left < 0 and i.risk_level == "CRITICAL" else "high" if i.days_left < 0 else "medium"
            # الفعل يطابق "صلاحية" (مؤنث ثابت) لا العنوان المتغير
            text = (f"انتهت صلاحية {i.title} {due_phrase(i.days_left)}" if i.days_left < 0
                    else f"تنتهي صلاحية {i.title} {due_phrase(i.days_left)}")
            out.append(Reason("OPERATIONAL", sev, text, loss))

    if "GOVERNANCE_PDPL" in weights:
        w = weights["GOVERNANCE_PDPL"] / 100
        n_parts = len(governance_parts(policies, inp.ropa, inp.structure_score))
        if inp.structure_score is not None and inp.structure_failures:
            sev_w = {"critical": 3, "high": 2, "medium": 1}
            total_loss = (100 - inp.structure_score) / n_parts * w
            denom = sum(sev_w[sv] for _, sv in inp.structure_failures)
            for title, sv in inp.structure_failures:
                out.append(Reason("GOVERNANCE_PDPL", "high" if sv == "critical" else "medium",
                                  f"معيار حوكمة غير مستوفى: {title}", total_loss * sev_w[sv] / denom))
        for p in policies:
            if p.days_left >= 0:
                continue
            loss = (1 / len(policies)) * 100 / n_parts * w
            if p.policy_type == "__MISSING_PRIVACY__":
                out.append(Reason("GOVERNANCE_PDPL", "high", "لم تُعتمد سياسة الخصوصية بعد", loss))
            else:
                out.append(Reason("GOVERNANCE_PDPL", "medium", f"فات موعد مراجعة {p.title}", loss))
        incomplete = [r for r in inp.ropa if not (r.has_purpose and r.has_owner and r.cross_border_documented)]
        if incomplete:
            missing = sum(3 - (r.has_purpose + r.has_owner + r.cross_border_documented) for r in incomplete)
            loss = missing / (3 * len(inp.ropa)) * 100 / n_parts * w
            n = len(incomplete)
            text = ("نشاط معالجة واحد ينقصه" if n == 1 else f"{n} من أنشطة المعالجة ينقصها") + " الغرض أو المسؤول أو توثيق النقل الخارجي"
            out.append(Reason("GOVERNANCE_PDPL", "medium", text, loss))

    if "CONTRACTS" in weights:
        avg = contracts_pillar(inp.audit_percentages) or 0
        loss = (100 - avg) * weights["CONTRACTS"] / 100
        if loss > 0:
            out.append(Reason("CONTRACTS", "medium", f"متوسط امتثال العقود المدققة {round(avg)}%", loss))

    order = {"critical": 0, "high": 1, "medium": 2}
    return sorted(out, key=lambda r: (order[r.severity], -r.points))


def compute_score(inp: ScoreInputs) -> ScoreResult:
    f = inp.plan_features
    has_gov = bool({"GOVERNANCE", "PDPL"} & f)
    policies = _with_required_policies(inp.policies, f) if has_gov else inp.policies
    pillars: dict[str, float | None] = {
        "OPERATIONAL": operational_pillar(inp.items) if "OPERATIONAL" in f else None,
        "GOVERNANCE_PDPL": governance_pillar(policies, inp.ropa, inp.structure_score) if has_gov else None,
        "CONTRACTS": contracts_pillar(inp.audit_percentages) if "CONTRACTS" in f else None,
    }
    active = {k: BASE_WEIGHTS[k] for k, v in pillars.items() if v is not None}
    if not active:
        return ScoreResult(score=None, pillars=pillars, weights_used={})

    total_w = sum(active.values())
    weights = {k: 100 * w / total_w for k, w in active.items()}
    raw = sum(pillars[k] * w for k, w in active.items()) / total_w  # type: ignore[operator]
    score = round(raw)
    reasons = _reasons(inp, policies, weights)

    capped = False
    if any(i.risk_level == "CRITICAL" and i.days_left < 0 for i in inp.items) and score > CRITICAL_EXPIRED_CAP:
        reasons.insert(0, Reason("OPERATIONAL", "critical",
                                 f"المؤشر محدود عند {CRITICAL_EXPIRED_CAP}% حتى يُجدَّد الترخيص الحرج المنتهي",
                                 score - CRITICAL_EXPIRED_CAP))
        score, capped = CRITICAL_EXPIRED_CAP, True

    return ScoreResult(
        score=score,
        pillars={k: (round(v, 1) if v is not None else None) for k, v in pillars.items()},
        weights_used={k: round(v, 2) for k, v in weights.items()},
        capped=capped,
        reasons=reasons,
    )
