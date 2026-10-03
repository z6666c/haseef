"""إدارة المحتوى المرجعي من لوحة التحكم: معايير الحوكمة، كتالوج الالتزامات، المكتبة المرجعية.

  * الدعم الفني والمدير العام يعدّلون ويُظهرون ويخفون ويرفعون الملفات.
  * اعتماد المحتوى (إزالة شارة "مسودة — قيد المراجعة") للمدير العام فقط.
  * كل تغيير في سجل التدقيق.
"""

from __future__ import annotations

import base64
import binascii
import json
import re
import uuid
from pathlib import Path
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Response, status
from pydantic import BaseModel, Field
from sqlalchemy import Connection, text

from ..config import get_settings
from ..deps import Admin, require_perm
from ..services import governance_service as gs
from .governance import file_response

router = APIRouter(prefix="/admin", tags=["admin-catalog"])

Review = Literal["DRAFT", "APPROVED"]
Category = Literal["GOVERNANCE", "POLICIES", "PDPL", "LABOR", "TAX", "COMMERCIAL", "SAFETY", "AML"]
LegalType = Literal["LLC", "SOLE_PROPRIETORSHIP", "CLOSED_JOINT_STOCK", "SIMPLIFIED_JOINT_STOCK",
                    "PUBLIC_JOINT_STOCK", "BRANCH_OF_FOREIGN"]

ALLOWED_MIME = {
    "application/pdf": ".pdf",
    "application/msword": ".doc",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
    "application/vnd.ms-excel": ".xls",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation": ".pptx",
    "text/plain": ".txt",
    "image/png": ".png",
    "image/jpeg": ".jpg",
}


def _require_approver(a: Admin, review_status: str | None) -> None:
    if review_status is not None and not a.can("content.approve"):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "اعتماد المحتوى أو إعادته لمسودة للمدير العام فقط")


def _patch(a: Admin, table: str, key_col: str, key, data: dict, audit_action: str) -> dict:
    data = {k: v for k, v in data.items() if v is not None or k in ("min_plan", "source_url", "url", "legal_reference", "authority")}
    if not data:
        return {"updated": False}
    cols = []
    params = {"k": key, "u": a.user_id}
    for k, v in data.items():
        if isinstance(v, (dict,)):
            cols.append(f"{k} = CAST(:{k} AS jsonb)")
            params[k] = json.dumps(v, ensure_ascii=False)
        else:
            cols.append(f"{k} = :{k}")
            params[k] = v
    n = a.conn.execute(text(f"UPDATE {table} SET {', '.join(cols)}, updated_by = :u, updated_at = now() WHERE {key_col} = :k"),
                       params).rowcount
    if not n:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "العنصر غير موجود")
    a.audit(audit_action, table, None, None, {"key": str(key), **data})
    return {"updated": True}


# ------------------------------------------------------------------ معايير الحوكمة
class StandardPatch(BaseModel):
    title: str | None = Field(default=None, min_length=3)
    description: str | None = None
    legal_reference: str | None = None
    source_url: str | None = None
    level: Literal["MANDATORY", "RECOMMENDED"] | None = None
    severity: Literal["critical", "high", "medium"] | None = None
    applies_legal_types: list[LegalType] | None = None
    is_visible: bool | None = None
    review_status: Review | None = None


@router.get("/catalog/standards")
def standards(a: Admin = Depends(require_perm("content.manage", "content.approve"))):
    c = a.conn
    return [dict(r) for r in c.execute(text("""
        SELECT code, domain, title, description, legal_reference, source_url, level, severity, applies_legal_types,
               rule, is_visible, review_status, sort, updated_at FROM gov_standards ORDER BY sort, code""")).mappings()]


@router.patch("/catalog/standards/{code}")
def patch_standard(code: str, body: StandardPatch, a: Admin = Depends(require_perm("content.manage", "content.approve"))):
    _require_approver(a, body.review_status)
    return _patch(a, "gov_standards", "code", code, body.model_dump(exclude_unset=True), "ADMIN_CATALOG_STANDARD")


# ------------------------------------------------------------------ الالتزامات
Kind = Literal["LICENSE", "REGISTRATION", "FILING", "POLICY", "PRACTICE"]
Domain = Literal["COMMERCIAL", "MUNICIPAL", "LABOR", "TAX", "SAFETY", "PDPL", "GOVERNANCE", "AML", "INSURANCE"]


class Applies(BaseModel):
    legal_types: list[LegalType] | None = None
    min_employees: int | None = Field(default=None, ge=0)
    personal_data: bool | None = None
    vat: bool | None = None
    industries: list[str] | None = None

    def clean(self) -> dict:
        return {k: v for k, v in self.model_dump().items() if v not in (None, [], "")}


class ObligationPatch(BaseModel):
    title: str | None = Field(default=None, min_length=3)
    description: str | None = None
    authority: str | None = None
    legal_reference: str | None = None
    source_url: str | None = None
    risk_level: Literal["CRITICAL", "HIGH", "MEDIUM"] | None = None
    applies: Applies | None = None
    is_visible: bool | None = None
    review_status: Review | None = None


class ObligationCreate(BaseModel):
    code: str = Field(pattern=r"^[A-Z][A-Z0-9_]{2,39}$")
    kind: Kind
    domain: Domain
    title: str = Field(min_length=3)
    description: str = Field(min_length=3)
    authority: str | None = None
    legal_reference: str | None = None
    source_url: str | None = None
    frequency: Literal["ONCE", "ANNUAL", "RENEWAL", "EVENT", "CONTINUOUS"]
    risk_level: Literal["CRITICAL", "HIGH", "MEDIUM"] = "HIGH"
    applies: Applies = Applies()


@router.get("/catalog/obligations")
def obligations(a: Admin = Depends(require_perm("content.manage", "content.approve"))):
    c = a.conn
    rows = c.execute(text("""
        SELECT c.code, c.kind, c.domain, c.title, c.description, c.authority, c.legal_reference, c.source_url, c.frequency,
               c.risk_level, c.compliance_category, c.policy_type, c.applies, c.is_visible, c.review_status, c.sort,
               c.updated_at, (SELECT count(*) FROM org_obligations o WHERE o.code = c.code) AS orgs
        FROM obligation_catalog c ORDER BY c.sort, c.code""")).mappings()
    return [dict(r) for r in rows]


@router.post("/catalog/obligations", status_code=201)
def create_obligation(body: ObligationCreate, a: Admin = Depends(require_perm("content.manage"))):
    if a.conn.execute(text("SELECT 1 FROM obligation_catalog WHERE code = :c"), {"c": body.code}).scalar_one_or_none():
        raise HTTPException(status.HTTP_409_CONFLICT, "الرمز مستخدم")
    a.conn.execute(text("""
        INSERT INTO obligation_catalog (code, kind, domain, title, description, authority, legal_reference, source_url,
                                        frequency, risk_level, applies, sort, updated_by)
        VALUES (:code, :kind, :domain, :title, :description, :authority, :legal_reference, :source_url,
                :frequency, :risk_level, CAST(:applies AS jsonb), 900, :u)"""),
        {**body.model_dump(exclude={"applies"}), "applies": json.dumps(body.applies.clean()), "u": a.user_id})
    a.audit("ADMIN_CATALOG_OBLIGATION_ADD", "obligation_catalog", None, None, {"code": body.code, "title": body.title})
    return {"code": body.code}


@router.patch("/catalog/obligations/{code}")
def patch_obligation(code: str, body: ObligationPatch, a: Admin = Depends(require_perm("content.manage", "content.approve"))):
    _require_approver(a, body.review_status)
    data = body.model_dump(exclude_unset=True, exclude={"applies"})
    if body.applies is not None:
        data["applies"] = body.applies.clean()
    return _patch(a, "obligation_catalog", "code", code, data, "ADMIN_CATALOG_OBLIGATION")


# ------------------------------------------------------------------ المكتبة
_LIB_ADMIN_COLS = """d.id, d.slug, d.kind, d.category, d.title, d.summary, d.url, d.file_name, d.file_mime, d.file_size,
                     d.policy_type, d.applies_legal_types, d.related_codes, d.is_visible, d.review_status, d.min_plan,
                     d.version, d.sort, d.created_at, d.updated_at,
                     cu.full_name AS created_by_name, uu.full_name AS updated_by_name,
                     (SELECT count(*) FROM internal_policies p WHERE p.source_library_id = d.id) AS adoptions"""


class LibraryCreate(BaseModel):
    kind: Literal["TEMPLATE", "LAW", "GUIDE", "FILE"]
    category: Category
    title: str = Field(min_length=3, max_length=300)
    summary: str | None = Field(default=None, max_length=1000)
    body_md: str | None = Field(default=None, max_length=200_000)
    url: str | None = Field(default=None, pattern=r"^https://", max_length=1000)
    policy_type: str | None = None
    applies_legal_types: list[LegalType] = []
    min_plan: Literal["ESSENTIAL", "PROFESSIONAL_GRC", "ENTERPRISE"] | None = None
    is_visible: bool = True
    # الملف: base64 (حتى لا نعتمد على multipart). الحد في الإعدادات.
    file_name: str | None = Field(default=None, max_length=200)
    file_mime: str | None = None
    file_base64: str | None = None


class LibraryPatch(BaseModel):
    category: Category | None = None
    title: str | None = Field(default=None, min_length=3, max_length=300)
    summary: str | None = Field(default=None, max_length=1000)
    body_md: str | None = Field(default=None, max_length=200_000)
    url: str | None = Field(default=None, pattern=r"^https://", max_length=1000)
    applies_legal_types: list[LegalType] | None = None
    min_plan: Literal["ESSENTIAL", "PROFESSIONAL_GRC", "ENTERPRISE"] | None = None
    is_visible: bool | None = None
    review_status: Review | None = None
    version: str | None = Field(default=None, max_length=20)


def _store_file(name: str, mime: str | None, b64: str) -> tuple[str, int, str]:
    mime = (mime or "").lower()
    if mime not in ALLOWED_MIME:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "نوع الملف غير مسموح. المسموح: PDF، Word، Excel، PowerPoint، نص، صور")
    try:
        data = base64.b64decode(b64, validate=True)
    except (binascii.Error, ValueError):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "تعذّرت قراءة الملف")
    limit = get_settings().max_upload_mb * 1024 * 1024
    if not data or len(data) > limit:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, f"حجم الملف يتجاوز {get_settings().max_upload_mb} ميجابايت")
    if mime == "application/pdf" and not data.startswith(b"%PDF"):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "الملف ليس PDF صالحاً")
    # اسم التخزين لا يحمل أي جزء من اسم المستخدم: يمنع اجتياز المسارات
    key = f"library/{uuid.uuid4().hex}{ALLOWED_MIME[mime]}"
    path = Path(get_settings().storage_dir) / key
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    return key, len(data), mime


def _safe_name(name: str) -> str:
    name = re.sub(r"[\\/\x00-\x1f]", "_", name).strip() or "ملف"
    return name[:200]


@router.get("/library")
def library(a: Admin = Depends(require_perm("content.manage", "content.approve"))):
    c = a.conn
    rows = c.execute(text(f"""SELECT {_LIB_ADMIN_COLS} FROM library_documents d
                              LEFT JOIN users cu ON cu.id = d.created_by LEFT JOIN users uu ON uu.id = d.updated_by
                              ORDER BY d.category, d.sort, d.title""")).mappings()
    return [dict(r) for r in rows]


@router.get("/library/{doc_id}")
def library_doc(doc_id: UUID, a: Admin = Depends(require_perm("content.manage", "content.approve"))):
    c = a.conn
    r = c.execute(text(f"""SELECT {_LIB_ADMIN_COLS}, d.body_md FROM library_documents d
                           LEFT JOIN users cu ON cu.id = d.created_by LEFT JOIN users uu ON uu.id = d.updated_by
                           WHERE d.id = :id"""), {"id": doc_id}).mappings().one_or_none()
    if not r:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "المستند غير موجود")
    return dict(r)


@router.get("/library/{doc_id}/file")
def library_file(doc_id: UUID, a: Admin = Depends(require_perm("content.manage", "content.approve"))):
    c = a.conn
    r = c.execute(text("SELECT file_key, file_name, file_mime FROM library_documents WHERE id = :id"), {"id": doc_id}).mappings().one_or_none()
    if not r or not r["file_key"]:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "الملف غير موجود")
    return file_response(r["file_key"], r["file_name"], r["file_mime"])


@router.post("/library", status_code=201)
def create_doc(body: LibraryCreate, a: Admin = Depends(require_perm("content.manage"))):
    key = size = mime = None
    name = None
    if body.kind == "FILE":
        if not (body.file_base64 and body.file_name):
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "اختر ملفاً للرفع")
        key, size, mime = _store_file(body.file_name, body.file_mime, body.file_base64)
        name = _safe_name(body.file_name)
    if body.kind == "LAW" and not body.url:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "أدخل رابط المصدر الرسمي (يبدأ بـ https)")
    if body.kind in ("TEMPLATE", "GUIDE") and not (body.body_md or "").strip():
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "أدخل نص المستند")
    doc_id = a.conn.execute(text("""
        INSERT INTO library_documents (kind, category, title, summary, body_md, url, file_name, file_mime, file_size, file_key,
                                       policy_type, applies_legal_types, is_visible, min_plan, sort, created_by, updated_by)
        VALUES (:kind, :category, :title, :summary, :body_md, :url, :fname, :fmime, :fsize, :fkey,
                :policy_type, :applies, :is_visible, :min_plan, 900, :u, :u) RETURNING id"""),
        {**body.model_dump(exclude={"file_base64", "file_name", "file_mime", "applies_legal_types"}),
         "applies": body.applies_legal_types, "fname": name, "fmime": mime, "fsize": size, "fkey": key,
         "u": a.user_id}).scalar_one()
    a.audit("ADMIN_LIBRARY_ADD", "library_document", doc_id, None, {"title": body.title, "kind": body.kind, "file": name})
    return {"id": doc_id}


@router.patch("/library/{doc_id}")
def patch_doc(doc_id: UUID, body: LibraryPatch, a: Admin = Depends(require_perm("content.manage", "content.approve"))):
    _require_approver(a, body.review_status)
    return _patch(a, "library_documents", "id", doc_id, body.model_dump(exclude_unset=True), "ADMIN_LIBRARY_EDIT")


@router.delete("/library/{doc_id}", status_code=204)
def delete_doc(doc_id: UUID, a: Admin = Depends(require_perm("content.approve"))):
    """الحذف للمدير العام فقط؛ الإخفاء متاح للدعم الفني ويكفي في أغلب الحالات."""
    r = a.conn.execute(text("DELETE FROM library_documents WHERE id = :id RETURNING title, file_key"), {"id": doc_id}).one_or_none()
    if not r:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "المستند غير موجود")
    if r.file_key:
        p = Path(get_settings().storage_dir) / r.file_key
        p.unlink(missing_ok=True)
    a.audit("ADMIN_LIBRARY_DELETE", "library_document", doc_id, None, {"title": r.title})
    return Response(status_code=204)


# ------------------------------------------------------------------ نظرة على حوكمة منشأة
@router.get("/organizations/{org_id}/governance")
def org_governance(org_id: UUID, a: Admin = Depends(require_perm("orgs.view"))):
    c = a.conn
    if not c.execute(text("SELECT 1 FROM organizations WHERE id = :o"), {"o": org_id}).scalar_one_or_none():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "لم يُعثر على المنشأة")
    obligations = gs.list_obligations(c, org_id)
    o = {"o": org_id}
    pdpl = {
        "records": c.execute(text("SELECT count(*) FROM pdpl_data_records WHERE org_id = :o"), o).scalar_one(),
        "requests_open": c.execute(text("""SELECT count(*) FROM pdpl_requests WHERE org_id = :o
                                           AND status IN ('OPEN','IN_PROGRESS')"""), o).scalar_one(),
        "requests_overdue": c.execute(text("""SELECT count(*) FROM pdpl_requests WHERE org_id = :o
                                              AND status IN ('OPEN','IN_PROGRESS') AND due_on < app.today_riyadh()"""), o).scalar_one(),
        "incidents_open": c.execute(text("SELECT count(*) FROM pdpl_incidents WHERE org_id = :o AND status <> 'CLOSED'"), o).scalar_one(),
        "incidents_notify_overdue": c.execute(text("""SELECT count(*) FROM pdpl_incidents WHERE org_id = :o AND harm_likely
            AND authority_notified_at IS NULL AND status <> 'CLOSED' AND now() > discovered_at + interval '72 hours'"""), o).scalar_one(),
    }
    return {
        "pdpl": pdpl,
        "bodies": gs.structure(c, org_id),
        "latest_check": gs.latest_run(c, org_id),
        "obligations": {
            "total": len(obligations),
            "in_place": sum(o["effective_status"] == "IN_PLACE" for o in obligations),
            "pending": sum(o["effective_status"] in ("PENDING", "AT_RISK") for o in obligations),
        },
    }
