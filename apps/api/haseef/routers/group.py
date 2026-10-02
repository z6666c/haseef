"""المنشآت المتعددة (باقة كبار العملاء): الشركة الأم وتابعاتها وفروعها في لوحة موحدة.

الأمان:
  * قائمة معرّفات المجموعة فقط تُقرأ بصلاحية المنصة (الأم + من parent_org_id = الأم).
  * بيانات كل منشأة تُقرأ في معاملة RLS خاصة بها وباسم المستخدم نفسه؛ فلا يظهر إلا ما هو عضو فيه فعلاً.
  * الإضافة للمجموعة: مدير المنشأة الأم فقط، وتُنشأ التابعة بعضوية مدير له واشتراك مرتبط باشتراك الأم.
"""

from __future__ import annotations

import json
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import Connection, text

from ..db import platform_tx, tenant_tx
from ..deps import Tenant, get_tenant
from ..services import governance_service as gs
from ..services.entitlements import has_feature, org_plan
from .compliance import _audit

router = APIRouter(prefix="/group", tags=["group"])

LegalType = Literal["LLC", "SOLE_PROPRIETORSHIP", "CLOSED_JOINT_STOCK", "SIMPLIFIED_JOINT_STOCK",
                    "PUBLIC_JOINT_STOCK", "BRANCH_OF_FOREIGN"]
MAX_ENTITIES = 25


def _root_and_ids(org_id: UUID) -> tuple[UUID, list[UUID]]:
    with platform_tx() as p:
        parent = p.execute(text("SELECT parent_org_id FROM organizations WHERE id = :o"), {"o": org_id}).scalar_one()
        root = parent or org_id
        ids = [r for (r,) in p.execute(text("""
            SELECT id FROM organizations WHERE (id = :r OR parent_org_id = :r) AND is_active
            ORDER BY (id <> :r), name"""), {"r": root})]
    return root, ids


def _entity_summary(c: Connection, org_id: UUID, role: str) -> dict:
    o = {"o": org_id}
    org = c.execute(text("""SELECT id, name, cr_number, entity_legal_type, entity_relation, commercial_size,
                                   haseef_score, score_computed_at FROM organizations WHERE id = :o"""), o).mappings().one()
    items = c.execute(text("""SELECT count(*) FILTER (WHERE status = 'EXPIRED') AS expired,
                                     count(*) FILTER (WHERE status = 'EXPIRING_SOON') AS expiring,
                                     count(*) AS total FROM v_compliance_items WHERE org_id = :o"""), o).mappings().one()
    policies_due = c.execute(text("""SELECT count(*) FROM v_internal_policies
        WHERE org_id = :o AND effective_status IN ('NEEDS_REVIEW','OVERDUE_REVIEW')"""), o).scalar_one()
    obligations = c.execute(text("""SELECT count(*) FILTER (WHERE status = 'PENDING') AS pending, count(*) AS total
                                    FROM org_obligations WHERE org_id = :o"""), o).mappings().one()
    incidents = c.execute(text("SELECT count(*) FROM pdpl_incidents WHERE org_id = :o AND status <> 'CLOSED'"), o).scalar_one()
    run = gs.latest_run(c, org_id)
    plan = org_plan(c, org_id)
    return {**dict(org), "role": role, "plan_tier": plan["plan_tier"], "items": dict(items),
            "policies_due": policies_due, "obligations": dict(obligations), "open_incidents": incidents,
            "structure_score": run["structure_score"] if run else None}


@router.get("")
def group_overview(t: Tenant = Depends(get_tenant)):
    root, ids = _root_and_ids(t.org_id)
    if root == t.org_id:
        available = has_feature(t.conn, t.org_id, "MULTI_ENTITY")
        root_role = t.role
    else:
        with tenant_tx(root, t.principal.user_id) as rc:
            root_role = rc.execute(text("SELECT role FROM memberships WHERE user_id = :u AND is_active"),
                                   {"u": t.principal.user_id}).scalar_one_or_none()
            available = has_feature(rc, root, "MULTI_ENTITY") if root_role else has_feature(t.conn, t.org_id, "MULTI_ENTITY")
    if not available:
        return {"available": False, "root_id": root, "entities": [], "can_manage": False, "max_entities": MAX_ENTITIES}

    entities = []
    for oid in ids:
        if oid == t.org_id:
            entities.append(_entity_summary(t.conn, oid, t.role))
            continue
        with tenant_tx(oid, t.principal.user_id) as c:
            role = c.execute(text("SELECT role FROM memberships WHERE user_id = :u AND is_active"),
                             {"u": t.principal.user_id}).scalar_one_or_none()
            if role:
                entities.append(_entity_summary(c, oid, role))
    scores = [e["haseef_score"] for e in entities if e["haseef_score"] is not None]
    totals = {
        "entities": len(entities),
        "avg_score": round(sum(scores) / len(scores)) if scores else None,
        "expired": sum(e["items"]["expired"] for e in entities),
        "expiring": sum(e["items"]["expiring"] for e in entities),
        "policies_due": sum(e["policies_due"] for e in entities),
        "obligations_pending": sum(e["obligations"]["pending"] for e in entities),
        "open_incidents": sum(e["open_incidents"] for e in entities),
    }
    return {"available": True, "root_id": root, "entities": entities, "totals": totals,
            "hidden_entities": len(ids) - len(entities),
            "can_manage": root_role == "ORG_ADMIN" and t.org_id == root, "max_entities": MAX_ENTITIES}


class EntityIn(BaseModel):
    name: str = Field(min_length=2, max_length=255)
    cr_number: str = Field(pattern=r"^\d{10}$")
    entity_legal_type: LegalType
    entity_relation: Literal["SUBSIDIARY", "BRANCH", "AFFILIATE"] = "SUBSIDIARY"
    industry_type: str | None = Field(default=None, max_length=100)
    commercial_size: Literal["MICRO", "SMALL", "MEDIUM"] | None = None


@router.post("/entities", status_code=201)
def add_entity(body: EntityIn, t: Tenant = Depends(get_tenant)):
    t.require("ORG_ADMIN")
    root, ids = _root_and_ids(t.org_id)
    if root != t.org_id:
        raise HTTPException(status.HTTP_409_CONFLICT, "أضف المنشآت من حساب الشركة الأم")
    if not has_feature(t.conn, t.org_id, "MULTI_ENTITY"):
        raise HTTPException(status.HTTP_402_PAYMENT_REQUIRED, "المنشآت المتعددة متاحة في باقة كبار العملاء")
    if len(ids) >= MAX_ENTITIES:
        raise HTTPException(status.HTTP_409_CONFLICT, f"الحد الأعلى {MAX_ENTITIES} منشأة في المجموعة. تواصل مع فريق حصيف للزيادة.")
    sub = t.conn.execute(text("""SELECT plan_tier, billing_cycle, ends_at, billing_status FROM subscriptions
        WHERE org_id = :o AND billing_status IN ('TRIAL','ACTIVE','PAST_DUE') LIMIT 1"""), {"o": t.org_id}).mappings().one()
    with platform_tx() as p:
        if p.execute(text("SELECT 1 FROM organizations WHERE cr_number = :cr"), {"cr": body.cr_number}).first():
            raise HTTPException(status.HTTP_409_CONFLICT, "يوجد منشأة مسجلة بهذا السجل التجاري. تواصل مع فريق حصيف لربطها.")
        oid = p.execute(text("""
            INSERT INTO organizations (cr_number, name, entity_legal_type, industry_type, commercial_size,
                                       parent_org_id, entity_relation)
            VALUES (:cr, :n, :lt, :i, :s, :root, :rel) RETURNING id"""),
            {"cr": body.cr_number, "n": body.name, "lt": body.entity_legal_type, "i": body.industry_type,
             "s": body.commercial_size, "root": root, "rel": body.entity_relation}).scalar_one()
        p.execute(text("INSERT INTO memberships (org_id, user_id, role) VALUES (:o, :u, 'ORG_ADMIN')"),
                  {"o": oid, "u": t.principal.user_id})
        # التابعة مشمولة باشتراك الأم حتى نهايته
        p.execute(text("""INSERT INTO subscriptions (org_id, plan_tier, billing_cycle, starts_at, ends_at, billing_status)
                          VALUES (:o, :t, :c, now(), :e, :b)"""),
                  {"o": oid, "t": sub["plan_tier"], "c": sub["billing_cycle"], "e": sub["ends_at"], "b": sub["billing_status"]})
        gs.apply_template(p, oid)
        gs.sync_obligations(p, oid)
        p.execute(text("""INSERT INTO audit_log (org_id, actor_user_id, action, entity_type, entity_id, changes)
                          VALUES (:o, :u, 'GROUP_ENTITY_CREATED', 'organization', :o, CAST(:c AS jsonb))"""),
                  {"o": oid, "u": t.principal.user_id,
                   "c": json.dumps({"parent": str(root), "relation": body.entity_relation})})
    _audit(t.conn, t, "GROUP_ENTITY_ADD", "organization", oid, {"name": body.name, "relation": body.entity_relation})
    return {"id": oid}
