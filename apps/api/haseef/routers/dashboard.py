from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import text

from ..deps import Tenant, get_tenant
from ..schemas import AlertRuleIn, ComplianceItemOut, DashboardOut, GovernanceSummary, PdplSummary, ScoreOut
from .compliance import _ITEM_COLS, _audit

router = APIRouter(tags=["dashboard"])


@router.get("/dashboard", response_model=DashboardOut)
def dashboard(t: Tenant = Depends(get_tenant)) -> DashboardOut:
    c = t.conn
    org = c.execute(text("""
        SELECT o.name, o.cr_number, o.haseef_score, o.score_breakdown, o.score_computed_at,
               s.plan_tier, COALESCE(pl.features, '{}') AS features,
               (s.id IS NOT NULL AND s.billing_status IN ('TRIAL','ACTIVE') AND now() BETWEEN s.starts_at AND s.ends_at) AS automation_active
        FROM organizations o
        LEFT JOIN subscriptions s ON s.org_id = o.id AND s.billing_status IN ('TRIAL','ACTIVE','PAST_DUE')
        LEFT JOIN plans pl ON pl.tier = s.plan_tier
        WHERE o.id = :o"""), {"o": t.org_id}).mappings().one()
    features = set(org["features"])
    bd = org["score_breakdown"] or {}
    greeting = c.execute(text("SELECT full_name FROM users WHERE id = :u"), {"u": t.principal.user_id}).scalar_one()

    action = c.execute(text(
        f"SELECT {_ITEM_COLS} FROM v_compliance_items WHERE action_required ORDER BY expiry_date")).mappings()
    counts = c.execute(text("""
        SELECT count(*) FILTER (WHERE status='ACTIVE')        AS active,
               count(*) FILTER (WHERE status='EXPIRING_SOON') AS expiring_soon,
               count(*) FILTER (WHERE status='EXPIRED')       AS expired
        FROM v_compliance_items""")).mappings().one()
    policies_due = c.execute(text(
        "SELECT count(*) FROM v_internal_policies WHERE effective_status IN ('NEEDS_REVIEW','OVERDUE_REVIEW')")).scalar_one()

    gov = GovernanceSummary(available="GOVERNANCE" in features)
    if gov.available:
        last = c.execute(text("""SELECT title, meeting_date, status FROM governance_resolutions
                                 ORDER BY meeting_date DESC LIMIT 1""")).mappings().one_or_none()
        doa = c.execute(text("""SELECT count(*) AS n, max(effective_from) AS last FROM authority_matrix
                                WHERE effective_to IS NULL OR effective_to >= current_date""")).mappings().one()
        gov = GovernanceSummary(
            available=True,
            last_meeting_title=last["title"] if last else None,
            last_meeting_date=last["meeting_date"] if last else None,
            last_meeting_status=last["status"] if last else None,
            doa_rules=doa["n"], doa_last_updated=doa["last"],
        )

    pdpl = PdplSummary(available="PDPL" in features)
    if pdpl.available:
        r = c.execute(text("""
            SELECT count(*) AS n,
                   count(*) FILTER (WHERE length(trim(purpose)) > 0 AND owner_membership_id IS NOT NULL) AS complete,
                   count(*) FILTER (WHERE cross_border_transfer) AS cross_border
            FROM pdpl_data_records""")).mappings().one()
        pdpl = PdplSummary(available=True, records=r["n"], complete_records=r["complete"],
                           completeness_pct=round(100 * r["complete"] / r["n"]) if r["n"] else None,
                           cross_border=r["cross_border"])

    return DashboardOut(
        org_name=org["name"],
        cr_number=org["cr_number"],
        greeting_name=greeting,
        plan_tier=org["plan_tier"],
        automation_active=bool(org["automation_active"]),
        score=ScoreOut(
            score=org["haseef_score"],
            pillars=bd.get("pillars", {}),
            weights_used=bd.get("weights_used", {}),
            capped_by_critical_expiry=bd.get("capped_by_critical_expiry", False),
            reasons=bd.get("reasons", []),
            computed_at=org["score_computed_at"],
        ),
        action_required=[ComplianceItemOut(**r) for r in action],
        counts={**dict(counts), "policies_due": policies_due},
        governance=gov,
        pdpl=pdpl,
    )


@router.get("/alert-rules")
def list_alert_rules(t: Tenant = Depends(get_tenant)):
    return [dict(r) for r in t.conn.execute(text(
        "SELECT id, target_type, target_id, days_before, channels, is_enabled FROM alert_rules ORDER BY target_type, target_id NULLS FIRST")).mappings()]


@router.put("/alert-rules")
def upsert_alert_rule(body: AlertRuleIn, t: Tenant = Depends(get_tenant)):
    """قاعدة افتراضية (target_id فارغ) أو خاصة بعنصر. الإدراج أو التحديث حسب الوجود."""
    t.require("ORG_ADMIN", "COMPLIANCE_OFFICER")
    params = {**body.model_dump(), "org": t.org_id}
    cond = "target_id IS NULL" if body.target_id is None else "target_id = :target_id"
    updated = t.conn.execute(text(f"""
        UPDATE alert_rules SET days_before=:days_before, channels=:channels, is_enabled=:is_enabled
        WHERE target_type=:target_type AND {cond} RETURNING id"""), params).scalar_one_or_none()
    rule_id = updated or t.conn.execute(text("""
        INSERT INTO alert_rules (org_id, target_type, target_id, days_before, channels, is_enabled)
        VALUES (:org, :target_type, :target_id, :days_before, :channels, :is_enabled) RETURNING id"""), params).scalar_one()
    _audit(t.conn, t, "UPSERT", "alert_rule", rule_id, body.model_dump())
    return {"id": rule_id}


@router.get("/alert-dispatches")
def my_dispatches(t: Tenant = Depends(get_tenant), limit: int = 100):
    return [dict(r) for r in t.conn.execute(text("""
        SELECT id, target_type, target_id, due_date, threshold_days, channel, status, skip_reason,
               scheduled_for, sent_at, delivered_at
        FROM alert_dispatches ORDER BY created_at DESC LIMIT :l"""), {"l": min(limit, 500)}).mappings()]
