"""واجهة العميل: هيكل الحوكمة وفحصه، الالتزامات، المكتبة المرجعية، وتبنّي النماذج."""

from __future__ import annotations

from datetime import date, timedelta
from pathlib import Path
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Response, status
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlalchemy import text

from ..config import get_settings
from ..deps import WRITERS, Tenant, get_tenant
from ..services import governance_service as gs
from .compliance import _audit

router = APIRouter(tags=["governance"])

BodyType = Literal["OWNER", "GENERAL_ASSEMBLY", "PARTNERS_ASSEMBLY", "BOARD", "MANAGER", "EXECUTIVE_MANAGEMENT",
                   "AUDIT_COMMITTEE", "NOMINATION_REMUNERATION_COMMITTEE", "RISK_COMMITTEE", "EXECUTIVE_COMMITTEE",
                   "OTHER_COMMITTEE", "COMPANY_SECRETARY", "INTERNAL_AUDIT", "COMPLIANCE_FUNCTION", "DPO"]
Position = Literal["CHAIR", "VICE_CHAIR", "MEMBER", "SECRETARY", "HEAD"]


class ProfileIn(BaseModel):
    employees_count: int | None = Field(default=None, ge=0, le=1_000_000)
    fiscal_year_end_month: int = Field(default=12, ge=1, le=12)
    processes_personal_data: bool = True
    vat_registered: bool | None = None
    has_bylaws: bool = False
    bylaws_updated_on: date | None = None
    auditor_name: str | None = Field(default=None, max_length=200)
    auditor_appointed_on: date | None = None
    beneficial_owners_filed_on: date | None = None
    last_assembly_on: date | None = None
    last_fs_filed_on: date | None = None


class BodyIn(BaseModel):
    body_type: BodyType
    name: str = Field(min_length=2, max_length=150)
    mandate: str | None = Field(default=None, max_length=2000)
    meetings_per_year: int | None = Field(default=None, ge=0, le=52)


class MemberIn(BaseModel):
    full_name: str = Field(min_length=2, max_length=150)
    position: Position = "MEMBER"
    is_independent: bool = False
    is_executive: bool = False
    appointed_on: date | None = None
    term_ends_on: date | None = None


class ObligationIn(BaseModel):
    status: Literal["PENDING", "IN_PLACE", "NOT_APPLICABLE"]
    note: str | None = Field(default=None, max_length=1000)


def _write(t: Tenant) -> None:
    t.require(*WRITERS)


def _after_change(t: Tenant) -> None:
    """أي تعديل على الهيكل أو الملف يعيد الفحص والمؤشر فوراً، فلا تبقى نتيجة قديمة معروضة."""
    gs.run_and_save(t.conn, t.org_id, t.principal.user_id)


# ------------------------------------------------------------------ الهيكل
@router.get("/governance/structure")
def get_structure(t: Tenant = Depends(get_tenant)):
    org = t.conn.execute(text("SELECT entity_legal_type, commercial_size FROM organizations")).mappings().one()
    return {
        "legal_type": org["entity_legal_type"], "size": org["commercial_size"],
        "profile": gs.get_profile(t.conn, t.org_id),
        "bodies": gs.structure(t.conn, t.org_id),
        "latest_check": gs.latest_run(t.conn, t.org_id),
        "example_title": gs.example_title(org["entity_legal_type"]),
    }


@router.post("/governance/structure/apply-template")
def apply_template(t: Tenant = Depends(get_tenant)):
    _write(t)
    n = gs.apply_template(t.conn, t.org_id, force=True)
    _audit(t.conn, t, "GOV_APPLY_TEMPLATE", "organization", t.org_id, {"bodies_added": n})
    _after_change(t)
    return {"bodies_added": n}


@router.post("/governance/structure/apply-example")
def apply_example(t: Tenant = Depends(get_tenant)):
    """يستبدل الهيكل بمثال جاهز لكيان المنشأة (يُطلب تأكيد في الواجهة لأنه يحذف الهيكل الحالي)."""
    _write(t)
    n = gs.apply_example(t.conn, t.org_id)
    _audit(t.conn, t, "GOV_APPLY_EXAMPLE", "organization", t.org_id, {"bodies": n})
    _after_change(t)
    return {"bodies": n}


@router.put("/governance/profile")
def update_profile(body: ProfileIn, t: Tenant = Depends(get_tenant)):
    _write(t)
    gs.get_profile(t.conn, t.org_id)
    data = body.model_dump()
    profile_sets = ", ".join(f"{k} = :{k}" for k in data)        # المفاتيح من النموذج لا من المستخدم
    t.conn.execute(text(f"UPDATE org_governance_profiles SET {profile_sets}, updated_by = :u, updated_at = now() WHERE org_id = :o"),
                   {**data, "u": t.principal.user_id, "o": t.org_id})
    _audit(t.conn, t, "GOV_PROFILE", "organization", t.org_id, data)
    gs.sync_obligations(t.conn, t.org_id)
    _after_change(t)
    return gs.get_profile(t.conn, t.org_id)


@router.post("/governance/bodies", status_code=201)
def add_body(body: BodyIn, t: Tenant = Depends(get_tenant)):
    _write(t)
    nxt = t.conn.execute(text("SELECT COALESCE(max(sort), 0) + 10 FROM org_bodies")).scalar_one()
    bid = t.conn.execute(text("""INSERT INTO org_bodies (org_id, body_type, name, mandate, meetings_per_year, sort)
                                 VALUES (:o, :body_type, :name, :mandate, :meetings_per_year, :s) RETURNING id"""),
                         {**body.model_dump(), "o": t.org_id, "s": nxt}).scalar_one()
    _audit(t.conn, t, "GOV_BODY_ADD", "org_body", bid, body.model_dump())
    _after_change(t)
    return {"id": bid}


@router.patch("/governance/bodies/{body_id}")
def update_body(body_id: UUID, body: BodyIn, t: Tenant = Depends(get_tenant)):
    _write(t)
    n = t.conn.execute(text("""UPDATE org_bodies SET body_type = :body_type, name = :name, mandate = :mandate,
                                   meetings_per_year = :meetings_per_year, updated_at = now() WHERE id = :id"""),
                       {**body.model_dump(), "id": body_id}).rowcount
    if not n:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "الجهاز غير موجود")
    _audit(t.conn, t, "GOV_BODY_EDIT", "org_body", body_id, body.model_dump())
    _after_change(t)
    return {"updated": True}


@router.delete("/governance/bodies/{body_id}", status_code=204)
def delete_body(body_id: UUID, t: Tenant = Depends(get_tenant)):
    _write(t)
    if not t.conn.execute(text("DELETE FROM org_bodies WHERE id = :id"), {"id": body_id}).rowcount:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "الجهاز غير موجود")
    _audit(t.conn, t, "GOV_BODY_DELETE", "org_body", body_id)
    _after_change(t)
    return Response(status_code=204)


@router.post("/governance/bodies/{body_id}/members", status_code=201)
def add_member(body_id: UUID, body: MemberIn, t: Tenant = Depends(get_tenant)):
    _write(t)
    if not t.conn.execute(text("SELECT 1 FROM org_bodies WHERE id = :id"), {"id": body_id}).scalar_one_or_none():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "الجهاز غير موجود")
    _check_terms(body)
    mid = t.conn.execute(text("""INSERT INTO org_body_members (org_id, body_id, full_name, position, is_independent,
                                                               is_executive, appointed_on, term_ends_on)
                                 VALUES (:o, :b, :full_name, :position, :is_independent, :is_executive,
                                         :appointed_on, :term_ends_on) RETURNING id"""),
                         {**body.model_dump(), "o": t.org_id, "b": body_id}).scalar_one()
    _audit(t.conn, t, "GOV_MEMBER_ADD", "org_body_member", mid, body.model_dump())
    _after_change(t)
    return {"id": mid}


@router.patch("/governance/members/{member_id}")
def update_member(member_id: UUID, body: MemberIn, t: Tenant = Depends(get_tenant)):
    _write(t)
    _check_terms(body)
    n = t.conn.execute(text("""UPDATE org_body_members SET full_name = :full_name, position = :position,
                                   is_independent = :is_independent, is_executive = :is_executive,
                                   appointed_on = :appointed_on, term_ends_on = :term_ends_on WHERE id = :id"""),
                       {**body.model_dump(), "id": member_id}).rowcount
    if not n:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "العضو غير موجود")
    _audit(t.conn, t, "GOV_MEMBER_EDIT", "org_body_member", member_id, body.model_dump())
    _after_change(t)
    return {"updated": True}


@router.delete("/governance/members/{member_id}", status_code=204)
def delete_member(member_id: UUID, t: Tenant = Depends(get_tenant)):
    _write(t)
    if not t.conn.execute(text("DELETE FROM org_body_members WHERE id = :id"), {"id": member_id}).rowcount:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "العضو غير موجود")
    _audit(t.conn, t, "GOV_MEMBER_DELETE", "org_body_member", member_id)
    _after_change(t)
    return Response(status_code=204)


def _check_terms(m: MemberIn) -> None:
    if m.is_independent and m.is_executive:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "لا يكون العضو مستقلاً وتنفيذياً في الوقت نفسه")
    if m.appointed_on and m.term_ends_on and m.term_ends_on < m.appointed_on:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "تاريخ انتهاء العضوية قبل تاريخ التعيين")


# ------------------------------------------------------------------ الفحص
@router.post("/governance/check")
def run_check(t: Tenant = Depends(get_tenant)):
    run = gs.run_and_save(t.conn, t.org_id, t.principal.user_id)
    _audit(t.conn, t, "GOV_CHECK", "organization", t.org_id,
           {"passed": run["passed"], "failed": run["failed"], "structure_score": run["structure_score"]})
    return run


@router.get("/governance/check")
def latest_check(t: Tenant = Depends(get_tenant)):
    return gs.latest_run(t.conn, t.org_id)


# ------------------------------------------------------------------ الالتزامات
@router.get("/obligations")
def obligations(t: Tenant = Depends(get_tenant)):
    gs.sync_obligations(t.conn, t.org_id)
    return gs.list_obligations(t.conn, t.org_id)


@router.patch("/obligations/{code}")
def set_obligation(code: str, body: ObligationIn, t: Tenant = Depends(get_tenant)):
    _write(t)
    n = t.conn.execute(text("""UPDATE org_obligations SET status = :s, note = :n, source = 'MANUAL',
                                   updated_by = :u, updated_at = now() WHERE code = :c"""),
                       {"s": body.status, "n": body.note, "u": t.principal.user_id, "c": code}).rowcount
    if not n:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "الالتزام غير موجود")
    _audit(t.conn, t, "OBLIGATION_STATUS", "obligation", None, {"code": code, **body.model_dump()})
    return {"updated": True}


# ------------------------------------------------------------------ المكتبة
_LIB_COLS = """id, kind, category, title, summary, url, file_name, file_mime, file_size, policy_type,
               applies_legal_types, related_codes, review_status, version, updated_at"""


def _plan_ok(t: Tenant) -> str:
    """شرط الباقة: المستند المقيد بباقة يظهر لمشتركيها وما فوقها."""
    return """(min_plan IS NULL OR min_plan IN (
        SELECT p2.tier FROM plans p2 JOIN subscriptions s ON s.org_id = :o
        JOIN plans p1 ON p1.tier = s.plan_tier
        WHERE s.billing_status IN ('TRIAL','ACTIVE','PAST_DUE') AND p2.monthly_price_sar <= p1.monthly_price_sar))"""


@router.get("/library")
def library(t: Tenant = Depends(get_tenant)):
    rows = t.conn.execute(text(f"SELECT {_LIB_COLS} FROM library_documents WHERE {_plan_ok(t)} ORDER BY category, sort, title"),
                          {"o": t.org_id}).mappings().all()
    adopted = {r for (r,) in t.conn.execute(text("SELECT source_library_id FROM internal_policies WHERE source_library_id IS NOT NULL"))}
    return [{**dict(r), "adopted": r["id"] in adopted} for r in rows]


@router.get("/library/{doc_id}")
def library_doc(doc_id: UUID, t: Tenant = Depends(get_tenant)):
    r = t.conn.execute(text(f"SELECT {_LIB_COLS}, body_md FROM library_documents WHERE id = :id AND {_plan_ok(t)}"),
                       {"id": doc_id, "o": t.org_id}).mappings().one_or_none()
    if not r:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "المستند غير موجود")
    return dict(r)


@router.get("/library/{doc_id}/file")
def library_file(doc_id: UUID, t: Tenant = Depends(get_tenant)):
    r = t.conn.execute(text(f"SELECT file_key, file_name, file_mime FROM library_documents WHERE id = :id AND {_plan_ok(t)}"),
                       {"id": doc_id, "o": t.org_id}).mappings().one_or_none()
    if not r or not r["file_key"]:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "الملف غير موجود")
    return file_response(r["file_key"], r["file_name"], r["file_mime"])


def file_response(key: str, name: str, mime: str | None) -> FileResponse:
    root = Path(get_settings().storage_dir).resolve()
    path = (root / key).resolve()
    if root not in path.parents or not path.is_file():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "الملف غير موجود")
    return FileResponse(path, media_type=mime or "application/octet-stream", filename=name)


@router.post("/library/{doc_id}/adopt", status_code=201)
def adopt(doc_id: UUID, t: Tenant = Depends(get_tenant)):
    """ينسخ النموذج إلى سياسات المنشأة كمسودة، لتعدّلها ثم تعتمدها."""
    _write(t)
    d = t.conn.execute(text(f"SELECT id, title, body_md, policy_type FROM library_documents WHERE id = :id AND {_plan_ok(t)}"),
                       {"id": doc_id, "o": t.org_id}).mappings().one_or_none()
    if not d or not d["body_md"] or not d["policy_type"]:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "النموذج غير متاح للتبني")
    org = t.conn.execute(text("SELECT name FROM organizations")).scalar_one()
    title = d["title"].removeprefix("نموذج ").strip()
    body = d["body_md"].replace("«اسم المنشأة»", org).replace("«اسم الشركة»", org)
    pid = t.conn.execute(text("""
        INSERT INTO internal_policies (org_id, policy_type, title, version, review_due_date, status, body_md, source_library_id)
        VALUES (:o, :pt, :title, '1.0', :due, 'DRAFT', :body, :src) RETURNING id"""),
        {"o": t.org_id, "pt": d["policy_type"], "title": title, "due": gs.riyadh_today() + timedelta(days=365),
         "body": body, "src": doc_id}).scalar_one()
    _audit(t.conn, t, "POLICY_ADOPT", "policy", pid, {"library_id": str(doc_id), "title": title})
    return {"policy_id": pid}


# ------------------------------------------------------------------ السياسات (تفاصيل واعتماد)
class PolicyUpdate(BaseModel):
    title: str = Field(min_length=2, max_length=255)
    body_md: str | None = Field(default=None, max_length=100_000)
    version: str = Field(default="1.0", max_length=20)


@router.get("/policies/{policy_id}")
def get_policy(policy_id: UUID, t: Tenant = Depends(get_tenant)):
    r = t.conn.execute(text("""SELECT v.id, v.policy_type, v.title, v.version, v.approval_date, v.review_due_date, v.status,
                                      v.effective_status, v.days_remaining, p.body_md, p.source_library_id
                               FROM v_internal_policies v JOIN internal_policies p ON p.id = v.id WHERE v.id = :id"""),
                       {"id": policy_id}).mappings().one_or_none()
    if not r:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "السياسة غير موجودة")
    return dict(r)


@router.patch("/policies/{policy_id}")
def update_policy(policy_id: UUID, body: PolicyUpdate, t: Tenant = Depends(get_tenant)):
    _write(t)
    n = t.conn.execute(text("""UPDATE internal_policies SET title = :title, body_md = :body_md, version = :version,
                                   updated_at = now() WHERE id = :id"""), {**body.model_dump(), "id": policy_id}).rowcount
    if not n:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "السياسة غير موجودة")
    _audit(t.conn, t, "UPDATE", "policy", policy_id, {"title": body.title, "version": body.version})
    return {"updated": True}


class ApproveIn(BaseModel):
    approval_date: date | None = None
    review_months: int = Field(default=12, ge=1, le=60)


@router.post("/policies/{policy_id}/approve")
def approve_policy(policy_id: UUID, body: ApproveIn, t: Tenant = Depends(get_tenant)):
    t.require("ORG_ADMIN")
    approved = body.approval_date or gs.riyadh_today()
    n = t.conn.execute(text("""UPDATE internal_policies SET status = 'ACTIVE', approval_date = :a,
                                   review_due_date = (CAST(:a AS date) + make_interval(months => :m))::date, updated_at = now()
                               WHERE id = :id"""), {"a": approved, "m": body.review_months, "id": policy_id}).rowcount
    if not n:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "السياسة غير موجودة")
    _audit(t.conn, t, "POLICY_APPROVE", "policy", policy_id, {"approval_date": approved})
    _after_change(t)
    return {"status": "ACTIVE"}
