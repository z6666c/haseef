from __future__ import annotations

import json
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import Connection, text

from ..deps import WRITERS, Tenant, get_tenant
from ..schemas import ComplianceItemIn, ComplianceItemOut, PolicyIn, PolicyOut, RenewIn
from ..services.score_service import recompute

router = APIRouter(tags=["compliance"])

_ITEM_COLS = """id, category, title, reference_number, issue_date, expiry_date, risk_level,
                renewal_url, metadata, status, days_remaining, action_required, created_at"""


def _audit(conn: Connection, t: Tenant, action: str, entity: str, entity_id, changes: dict | None = None) -> None:
    conn.execute(text("""INSERT INTO audit_log (org_id, actor_user_id, action, entity_type, entity_id, changes)
                         VALUES (:o, :u, :a, :e, :id, CAST(:c AS jsonb))"""),
                 {"o": t.org_id, "u": t.principal.user_id, "a": action, "e": entity, "id": entity_id,
                  "c": json.dumps(changes, default=str, ensure_ascii=False) if changes else None})


# ---------------------------------------------------------------- عناصر الامتثال
@router.get("/compliance-items", response_model=list[ComplianceItemOut])
def list_items(t: Tenant = Depends(get_tenant)):
    rows = t.conn.execute(text(f"SELECT {_ITEM_COLS} FROM v_compliance_items ORDER BY expiry_date")).mappings()
    return [ComplianceItemOut(**r) for r in rows]


@router.post("/compliance-items", response_model=ComplianceItemOut, status_code=201)
def create_item(body: ComplianceItemIn, t: Tenant = Depends(get_tenant)):
    t.require(*WRITERS)
    new_id = t.conn.execute(text("""
        INSERT INTO compliance_items (org_id, category, title, reference_number, issue_date, expiry_date,
                                      risk_level, renewal_url, metadata)
        VALUES (:org, :category, :title, :reference_number, :issue_date, :expiry_date,
                :risk_level, :renewal_url, CAST(:metadata AS jsonb))
        RETURNING id"""), {**body.model_dump(), "metadata": json.dumps(body.metadata), "org": t.org_id}).scalar_one()
    _audit(t.conn, t, "CREATE", "compliance_item", new_id, body.model_dump())
    recompute(t.conn, t.org_id)
    return _get_item(t, new_id)


@router.put("/compliance-items/{item_id}", response_model=ComplianceItemOut)
def update_item(item_id: UUID, body: ComplianceItemIn, t: Tenant = Depends(get_tenant)):
    t.require(*WRITERS)
    n = t.conn.execute(text("""
        UPDATE compliance_items SET category=:category, title=:title, reference_number=:reference_number,
            issue_date=:issue_date, expiry_date=:expiry_date, risk_level=:risk_level,
            renewal_url=:renewal_url, metadata=CAST(:metadata AS jsonb)
        WHERE id=:id AND archived_at IS NULL"""),
        {**body.model_dump(), "metadata": json.dumps(body.metadata), "id": item_id}).rowcount
    if not n:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "العنصر غير موجود")
    _audit(t.conn, t, "UPDATE", "compliance_item", item_id, body.model_dump())
    recompute(t.conn, t.org_id)
    return _get_item(t, item_id)


@router.post("/compliance-items/{item_id}/renew", response_model=ComplianceItemOut, status_code=201)
def renew_item(item_id: UUID, body: RenewIn, t: Tenant = Depends(get_tenant)):
    """يؤرشف العنصر الحالي وينشئ نسخة مجددة؛ تاريخ الاستحقاق الجديد يبدأ دورة تنبيهات جديدة."""
    t.require(*WRITERS)
    old = t.conn.execute(text("SELECT * FROM compliance_items WHERE id=:id AND archived_at IS NULL FOR UPDATE"),
                         {"id": item_id}).mappings().one_or_none()
    if old is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "العنصر غير موجود")
    if body.new_expiry_date <= old["expiry_date"]:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "تاريخ الانتهاء الجديد يجب أن يكون بعد الحالي")
    t.conn.execute(text("UPDATE compliance_items SET archived_at=now() WHERE id=:id"), {"id": item_id})
    new_id = t.conn.execute(text("""
        INSERT INTO compliance_items (org_id, category, title, reference_number, issue_date, expiry_date,
                                      risk_level, renewal_url, owner_membership_id, metadata)
        VALUES (:org, :category, :title, :ref, :issue, :expiry, :risk, :url, :owner,
                CAST(:meta AS jsonb) || jsonb_build_object('renewed_from', CAST(:old_id AS text)))
        RETURNING id"""), {
        "org": t.org_id, "category": old["category"], "title": old["title"],
        "ref": body.new_reference_number or old["reference_number"], "issue": body.new_issue_date,
        "expiry": body.new_expiry_date, "risk": old["risk_level"], "url": old["renewal_url"],
        "owner": old["owner_membership_id"], "meta": json.dumps(old["metadata"] or {}), "old_id": str(item_id),
    }).scalar_one()
    # قاعدة التنبيه الخاصة بالعنصر القديم تنتقل للجديد.
    t.conn.execute(text("UPDATE alert_rules SET target_id=:new WHERE target_type='COMPLIANCE_ITEM' AND target_id=:old"),
                   {"new": new_id, "old": item_id})
    _audit(t.conn, t, "RENEW", "compliance_item", new_id, {"renewed_from": item_id, **body.model_dump()})
    recompute(t.conn, t.org_id)
    return _get_item(t, new_id)


@router.delete("/compliance-items/{item_id}", status_code=204)
def archive_item(item_id: UUID, t: Tenant = Depends(get_tenant)):
    """لا حذف فعلي في منصة امتثال: الأرشفة تُبقي الأثر للتدقيق."""
    t.require("ORG_ADMIN", "COMPLIANCE_OFFICER")
    n = t.conn.execute(text("UPDATE compliance_items SET archived_at=now() WHERE id=:id AND archived_at IS NULL"),
                       {"id": item_id}).rowcount
    if not n:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "العنصر غير موجود")
    _audit(t.conn, t, "ARCHIVE", "compliance_item", item_id)
    recompute(t.conn, t.org_id)
    return Response(status_code=204)


def _get_item(t: Tenant, item_id) -> ComplianceItemOut:
    row = t.conn.execute(text(f"SELECT {_ITEM_COLS} FROM v_compliance_items WHERE id=:id"),
                         {"id": item_id}).mappings().one()
    return ComplianceItemOut(**row)


# ---------------------------------------------------------------- السياسات
_POLICY_COLS = "id, policy_type, title, version, approval_date, review_due_date, status, effective_status, days_remaining"


@router.get("/policies", response_model=list[PolicyOut])
def list_policies(t: Tenant = Depends(get_tenant)):
    rows = t.conn.execute(text(f"SELECT {_POLICY_COLS} FROM v_internal_policies ORDER BY review_due_date")).mappings()
    return [PolicyOut(**r) for r in rows]


@router.post("/policies", response_model=PolicyOut, status_code=201)
def create_policy(body: PolicyIn, t: Tenant = Depends(get_tenant)):
    t.require(*WRITERS)
    new_id = t.conn.execute(text("""
        INSERT INTO internal_policies (org_id, policy_type, title, version, approval_date, review_due_date, status)
        VALUES (:org, :policy_type, :title, :version, :approval_date, :review_due_date, :status) RETURNING id"""),
        {**body.model_dump(), "org": t.org_id}).scalar_one()
    _audit(t.conn, t, "CREATE", "policy", new_id, body.model_dump())
    recompute(t.conn, t.org_id)
    row = t.conn.execute(text(f"SELECT {_POLICY_COLS} FROM v_internal_policies WHERE id=:id"), {"id": new_id}).mappings().one()
    return PolicyOut(**row)
