"""واجهات admin.haseef.sa — بصلاحيات المنصة (تتجاوز RLS)، لفريق حصيف فقط."""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import Connection, text

from ..deps import get_platform_admin

router = APIRouter(prefix="/admin", tags=["admin"])


@router.get("/overview")
def overview(conn: Connection = Depends(get_platform_admin)):
    kpis = conn.execute(text("""
        SELECT
          (SELECT count(*) FROM organizations WHERE is_active)                               AS active_orgs,
          (SELECT count(*) FROM subscriptions WHERE billing_status = 'TRIAL')                  AS trials,
          (SELECT COALESCE(sum(CASE s.billing_cycle WHEN 'MONTHLY' THEN p.monthly_price_sar
                                                    ELSE p.yearly_price_sar / 12 END), 0)
             FROM subscriptions s JOIN plans p ON p.tier = s.plan_tier
             WHERE s.billing_status = 'ACTIVE')                                                AS mrr_sar,
          (SELECT round(avg(haseef_score)) FROM organizations WHERE haseef_score IS NOT NULL)  AS avg_score
    """)).mappings().one()
    by_plan = conn.execute(text("""
        SELECT plan_tier, count(*) AS n FROM subscriptions
        WHERE billing_status IN ('TRIAL','ACTIVE','PAST_DUE') GROUP BY plan_tier""")).mappings().all()
    by_industry = conn.execute(text("""
        SELECT COALESCE(industry_type, 'غير محدد') AS industry, count(*) AS n
        FROM organizations WHERE is_active GROUP BY 1 ORDER BY n DESC LIMIT 10""")).mappings().all()
    return {"kpis": dict(kpis), "by_plan": [dict(r) for r in by_plan], "by_industry": [dict(r) for r in by_industry]}


@router.get("/organizations")
def organizations(conn: Connection = Depends(get_platform_admin)):
    return [dict(r) for r in conn.execute(text("""
        SELECT o.id, o.name, o.cr_number, o.industry_type, o.haseef_score, o.created_at,
               s.plan_tier, s.billing_status, s.ends_at,
               (SELECT count(*) FROM memberships m WHERE m.org_id = o.id AND m.is_active) AS members
        FROM organizations o
        LEFT JOIN subscriptions s ON s.org_id = o.id AND s.billing_status IN ('TRIAL','ACTIVE','PAST_DUE')
        ORDER BY o.created_at DESC""")).mappings()]


@router.get("/dispatches")
def dispatches(conn: Connection = Depends(get_platform_admin), status: str | None = None, limit: int = 200):
    summary = conn.execute(text("""
        SELECT status, channel, count(*) AS n FROM alert_dispatches
        WHERE created_at > now() - interval '7 days' GROUP BY status, channel""")).mappings().all()
    rows = conn.execute(text("""
        SELECT d.id, o.name AS org_name, d.target_type, d.channel, d.recipient_address, d.status,
               d.threshold_days, d.due_date, d.scheduled_for, d.sent_at, d.delivered_at,
               d.provider, d.attempts, d.last_error, d.skip_reason, d.kind
        FROM alert_dispatches d JOIN organizations o ON o.id = d.org_id
        WHERE (CAST(:st AS text) IS NULL OR d.status = :st)
        ORDER BY d.created_at DESC LIMIT :l"""), {"st": status, "l": min(limit, 1000)}).mappings().all()
    return {"last_7_days": [dict(r) for r in summary], "items": [dict(r) for r in rows]}


@router.get("/ai-usage")
def ai_usage(conn: Connection = Depends(get_platform_admin)):
    return [dict(r) for r in conn.execute(text("""
        SELECT o.id AS org_id, o.name, s.plan_tier, p.monthly_ai_audits AS quota,
               count(DISTINCT l.audit_id)                    AS audits_this_month,
               COALESCE(sum(l.input_tokens + l.output_tokens), 0) AS tokens,
               COALESCE(sum(l.cost_sar), 0)                  AS cost_sar
        FROM organizations o
        LEFT JOIN subscriptions s ON s.org_id = o.id AND s.billing_status IN ('TRIAL','ACTIVE','PAST_DUE')
        LEFT JOIN plans p ON p.tier = s.plan_tier
        LEFT JOIN ai_usage_ledger l ON l.org_id = o.id
              AND l.created_at >= date_trunc('month', now() AT TIME ZONE 'Asia/Riyadh') AT TIME ZONE 'Asia/Riyadh'
        GROUP BY o.id, o.name, s.plan_tier, p.monthly_ai_audits
        ORDER BY cost_sar DESC""")).mappings()]
