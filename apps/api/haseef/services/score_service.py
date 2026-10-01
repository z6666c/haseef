"""جلب مدخلات مؤشر حصافة من قاعدة البيانات واحتسابه وحفظه.

يعمل على أي اتصال: اتصال منشأة (RLS) بعد كل تعديل، أو اتصال المنصة في المهمة الليلية.
"""

from __future__ import annotations

import json
from uuid import UUID

from sqlalchemy import Connection, text

from ..domain.score import ItemState, PolicyState, RopaState, ScoreInputs, ScoreResult, compute_score

_PLAN = text("""
    SELECT pl.features FROM subscriptions s JOIN plans pl ON pl.tier = s.plan_tier
    WHERE s.org_id = :o AND s.billing_status IN ('TRIAL','ACTIVE','PAST_DUE')
""")
_ITEMS = text("SELECT days_remaining, risk_level, title FROM v_compliance_items WHERE org_id = :o")
_POLICIES = text("SELECT days_remaining, title, policy_type FROM v_internal_policies WHERE org_id = :o AND status = 'ACTIVE'")
_ROPA = text("""
    SELECT (length(trim(purpose)) > 0)            AS has_purpose,
           (owner_membership_id IS NOT NULL)      AS has_owner,
           (NOT cross_border_transfer OR (transfer_destination IS NOT NULL AND transfer_safeguard IS NOT NULL))
                                                  AS cross_border_documented
    FROM pdpl_data_records WHERE org_id = :o
""")
_AUDITS = text("""
    SELECT DISTINCT ON (file_sha256) compliance_percentage
    FROM contract_audits
    WHERE org_id = :o AND status = 'COMPLETED' AND compliance_percentage IS NOT NULL
      AND created_at > now() - interval '12 months'
    ORDER BY file_sha256, created_at DESC
""")
_SAVE = text("""
    UPDATE organizations
    SET haseef_score = :score, score_breakdown = CAST(:breakdown AS jsonb), score_computed_at = now()
    WHERE id = :o
""")


def load_inputs(conn: Connection, org_id: UUID | str) -> ScoreInputs:
    p = {"o": str(org_id)}
    features = conn.execute(_PLAN, p).scalar_one_or_none() or []
    return ScoreInputs(
        plan_features=frozenset(features),
        items=[ItemState(r.days_remaining, r.risk_level, r.title) for r in conn.execute(_ITEMS, p)],
        policies=[PolicyState(r.days_remaining, r.title, r.policy_type) for r in conn.execute(_POLICIES, p)],
        ropa=[RopaState(r.has_purpose, r.has_owner, r.cross_border_documented) for r in conn.execute(_ROPA, p)],
        audit_percentages=[r.compliance_percentage for r in conn.execute(_AUDITS, p)],
    )


def recompute(conn: Connection, org_id: UUID | str) -> ScoreResult:
    result = compute_score(load_inputs(conn, org_id))
    conn.execute(_SAVE, {"o": str(org_id), "score": result.score, "breakdown": json.dumps(result.as_dict())})
    return result
