"""مؤشر حصافة (Haseef Score).

الأوزان الأساسية كما في الوثيقة: 35% تشغيلي، 35% حوكمة و PDPL، 30% عقود ولوائح.
الإصلاحات في 1.1:
  * الركن يُحتسب فقط إن كان متاحاً في باقة المنشأة **ولديه بيانات**؛ ثم تُعاد
    موازنة الأوزان. مشترك الأساس لا يُعاقَب بخسارة 35% لميزة لا يملكها، ولا تُمنح
    المنشأة 100% لركن لم تُدخل فيه شيئاً.
  * المنشأة بلا أي بيانات تحصل على None ("غير مُقيَّم") لا 100.
  * سقف للمخاطر الحرجة: عنصر حرج منتهٍ (كالسجل التجاري) يحد المؤشر عند 50،
    حتى لا تظهر منشأة سجلها منتهٍ بنسبة 85%.
"""

from __future__ import annotations

from dataclasses import dataclass, field

BASE_WEIGHTS = {"OPERATIONAL": 35, "GOVERNANCE_PDPL": 35, "CONTRACTS": 30}
RISK_WEIGHT = {"CRITICAL": 3, "HIGH": 2, "MEDIUM": 1}
CRITICAL_EXPIRED_CAP = 50


@dataclass(frozen=True)
class ItemState:
    days_left: int
    risk_level: str = "HIGH"


@dataclass(frozen=True)
class PolicyState:
    days_left: int            # حتى موعد المراجعة


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


@dataclass
class ScoreResult:
    score: int | None
    pillars: dict[str, float | None]
    weights_used: dict[str, float]
    capped: bool = False

    def as_dict(self) -> dict:
        return {
            "score": self.score,
            "pillars": self.pillars,
            "weights_used": self.weights_used,
            "capped_by_critical_expiry": self.capped,
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


def governance_pillar(policies: list[PolicyState], ropa: list[RopaState]) -> float | None:
    parts: list[float] = []
    if policies:
        parts.append(100 * sum(1 for p in policies if p.days_left >= 0) / len(policies))
    if ropa:
        def rec(r: RopaState) -> float:
            return (r.has_purpose + r.has_owner + r.cross_border_documented) / 3
        parts.append(100 * sum(rec(r) for r in ropa) / len(ropa))
    return sum(parts) / len(parts) if parts else None


def contracts_pillar(percentages: list[int]) -> float | None:
    return sum(percentages) / len(percentages) if percentages else None


def compute_score(inp: ScoreInputs) -> ScoreResult:
    f = inp.plan_features
    pillars: dict[str, float | None] = {
        "OPERATIONAL": operational_pillar(inp.items) if "OPERATIONAL" in f else None,
        "GOVERNANCE_PDPL": governance_pillar(inp.policies, inp.ropa)
            if ({"GOVERNANCE", "PDPL"} & f) else None,
        "CONTRACTS": contracts_pillar(inp.audit_percentages) if "CONTRACTS" in f else None,
    }
    active = {k: BASE_WEIGHTS[k] for k, v in pillars.items() if v is not None}
    if not active:
        return ScoreResult(score=None, pillars=pillars, weights_used={})

    total_w = sum(active.values())
    weights = {k: round(100 * w / total_w, 2) for k, w in active.items()}
    raw = sum(pillars[k] * w for k, w in active.items()) / total_w  # type: ignore[operator]
    score = round(raw)

    capped = False
    if any(i.risk_level == "CRITICAL" and i.days_left < 0 for i in inp.items) and score > CRITICAL_EXPIRED_CAP:
        score, capped = CRITICAL_EXPIRED_CAP, True

    return ScoreResult(
        score=score,
        pillars={k: (round(v, 1) if v is not None else None) for k, v in pillars.items()},
        weights_used=weights,
        capped=capped,
    )
