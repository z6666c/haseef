from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import text

from ..deps import Tenant, get_tenant
from ..schemas import AlertRuleIn, ComplianceItemOut, DashboardOut, ScoreOut
from .compliance import _ITEM_COLS, _audit

router = APIRouter(tags=["dashboard"])


@router.get("/dashboard", response_model=DashboardOut)
def dashboard(t: Tenant = Depends(get_tenant)) -> DashboardOut:
    org = t.conn.execute(text("""
        SELECT o.name, o.haseef_score, o.score_breakdown, o.score_computed_at, s.plan_tier
        FROM organizations o
        LEFT JOIN subscriptions s ON s.org_id = o.id AND s.billing_status IN ('TRIAL','ACTIVE','PAST_DUE')
        WHERE o.id = :o"""), {"o": t.org_id}).mappings().one()
    bd = org["score_breakdown"] or {}
    action = t.conn.execute(text(
        f"SELECT {_ITEM_COLS} FROM v_compliance_items WHERE action_required ORDER BY expiry_date")).mappings()
    counts = t.conn.execute(text("""
        SELECT count(*) FILTER (WHERE status='ACTIVE')        AS active,
               count(*) FILTER (WHERE status='EXPIRING_SOON') AS expiring_soon,
               count(*) FILTER (WHERE status='EXPIRED')       AS expired
        FROM v_compliance_items""")).mappings().one()
    overdue_policies = t.conn.execute(text(
        "SELECT count(*) FROM v_internal_policies WHERE effective_status IN ('NEEDS_REVIEW','OVERDUE_REVIEW')")).scalar_one()
    return DashboardOut(
        org_name=org["name"],
        plan_tier=org["plan_tier"],
        score=ScoreOut(
            score=org["haseef_score"],
            pillars=bd.get("pillars", {}),
            weights_used=bd.get("weights_used", {}),
            capped_by_critical_expiry=bd.get("capped_by_critical_expiry", False),
            computed_at=org["score_computed_at"],
        ),
        action_required=[ComplianceItemOut(**r) for r in action],
        counts={**dict(counts), "policies_due": overdue_policies},
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
