"""هيكل الحوكمة وفحصه، والتزامات المنشأة.

كل الدوال تعمل على اتصال منشأة (RLS) أو اتصال المنصة؛ الاستعلامات تحدد org_id صراحة
حتى تكون صحيحة في الحالتين.
"""

from __future__ import annotations

import json
from datetime import date
from uuid import UUID
from zoneinfo import ZoneInfo
from datetime import datetime

from sqlalchemy import Connection, text

from ..content.obligations import applies_to
from ..content.standards import STRUCTURE_TEMPLATES
from ..domain.governance_check import Body, Member, OrgContext, run_check
from .score_service import recompute

PROFILE_FIELDS = ("employees_count", "fiscal_year_end_month", "processes_personal_data", "vat_registered", "has_bylaws",
                  "bylaws_updated_on", "auditor_name", "auditor_appointed_on", "beneficial_owners_filed_on",
                  "last_assembly_on", "last_fs_filed_on")


def riyadh_today() -> date:
    return datetime.now(ZoneInfo("Asia/Riyadh")).date()


def _org(conn: Connection, org_id: UUID | str):
    return conn.execute(text("""SELECT id, entity_legal_type, commercial_size, industry_type
                                FROM organizations WHERE id = :o"""), {"o": str(org_id)}).mappings().one()


def get_profile(conn: Connection, org_id: UUID | str) -> dict:
    conn.execute(text("INSERT INTO org_governance_profiles (org_id) VALUES (:o) ON CONFLICT DO NOTHING"), {"o": str(org_id)})
    row = conn.execute(text(f"""SELECT {', '.join(PROFILE_FIELDS)}, template_applied_at, updated_at
                                FROM org_governance_profiles WHERE org_id = :o"""), {"o": str(org_id)}).mappings().one()
    return dict(row)


def apply_template(conn: Connection, org_id: UUID | str, *, force: bool = False) -> int:
    """ينشئ الهيكل الأساسي حسب الكيان إن لم يكن للمنشأة هيكل. يرجع عدد الأجهزة المضافة."""
    o = {"o": str(org_id)}
    if not force and conn.execute(text("SELECT count(*) FROM org_bodies WHERE org_id = :o"), o).scalar_one():
        return 0
    org = _org(conn, org_id)
    tpl = STRUCTURE_TEMPLATES.get(org["entity_legal_type"], [])
    existing = {r for (r,) in conn.execute(text("SELECT body_type FROM org_bodies WHERE org_id = :o"), o)}
    n = 0
    for i, (body_type, name, mandate, meetings) in enumerate(tpl):
        if body_type in existing:
            continue
        conn.execute(text("""INSERT INTO org_bodies (org_id, body_type, name, mandate, meetings_per_year, sort, from_template)
                             VALUES (:o, :t, :n, :m, :mp, :s, true)"""),
                     {**o, "t": body_type, "n": name, "m": mandate, "mp": meetings, "s": (i + 1) * 10})
        n += 1
    get_profile(conn, org_id)
    conn.execute(text("UPDATE org_governance_profiles SET template_applied_at = now() WHERE org_id = :o"), o)
    return n


def structure(conn: Connection, org_id: UUID | str) -> list[dict]:
    o = {"o": str(org_id)}
    bodies = conn.execute(text("""SELECT id, body_type, name, mandate, meetings_per_year, reports_to, sort, from_template
                                  FROM org_bodies WHERE org_id = :o ORDER BY sort, created_at"""), o).mappings().all()
    members = conn.execute(text("""SELECT id, body_id, full_name, position, is_independent, is_executive,
                                          appointed_on, term_ends_on
                                   FROM org_body_members WHERE org_id = :o
                                   ORDER BY CASE position WHEN 'CHAIR' THEN 0 WHEN 'VICE_CHAIR' THEN 1 WHEN 'HEAD' THEN 1
                                            WHEN 'SECRETARY' THEN 3 ELSE 2 END, full_name"""), o).mappings().all()
    by_body: dict = {}
    for m in members:
        by_body.setdefault(m["body_id"], []).append(dict(m))
    return [{**dict(b), "members": by_body.get(b["id"], [])} for b in bodies]


def _context(conn: Connection, org_id: UUID | str) -> OrgContext:
    o = {"o": str(org_id)}
    org = _org(conn, org_id)
    bodies = [Body(b["body_type"], b["name"], [Member(m["full_name"], m["position"], m["is_independent"],
                                                       m["is_executive"], m["term_ends_on"]) for m in b["members"]])
              for b in structure(conn, org_id)]
    policies = {r for (r,) in conn.execute(text("""SELECT DISTINCT policy_type FROM v_internal_policies
                                                   WHERE org_id = :o AND status = 'ACTIVE'"""), o)}
    ropa = conn.execute(text("SELECT count(*) FROM pdpl_data_records WHERE org_id = :o"), o).scalar_one()
    doa = conn.execute(text("""SELECT count(*) FROM authority_matrix WHERE org_id = :o
                               AND (effective_to IS NULL OR effective_to >= current_date)"""), o).scalar_one()
    return OrgContext(legal_type=org["entity_legal_type"], size=org["commercial_size"], profile=get_profile(conn, org_id),
                      bodies=bodies, active_policy_types=policies, ropa_count=ropa, doa_count=doa, today=riyadh_today())


def visible_standards(conn: Connection) -> list[dict]:
    rows = conn.execute(text("""SELECT code, domain, title, description, legal_reference, source_url, level, severity,
                                       applies_legal_types, rule, review_status, sort
                                FROM gov_standards WHERE is_visible ORDER BY sort, code""")).mappings().all()
    return [dict(r) for r in rows]


def run_and_save(conn: Connection, org_id: UUID | str, user_id: UUID | str | None) -> dict:
    standards = visible_standards(conn)
    results, score = run_check(standards, _context(conn, org_id))
    by_code = {s["code"]: s for s in standards}
    payload = [{**r.as_dict(), "legal_reference": by_code[r.code]["legal_reference"],
                "source_url": by_code[r.code]["source_url"], "review_status": by_code[r.code]["review_status"],
                "description": by_code[r.code]["description"]} for r in results]
    passed = sum(r.status == "PASS" for r in results)
    failed = sum(r.status == "FAIL" for r in results)
    na = sum(r.status == "NA" for r in results)
    run_id = conn.execute(text("""
        INSERT INTO gov_check_runs (org_id, run_by, passed, failed, not_applicable, structure_score, results)
        VALUES (:o, :u, :p, :f, :n, :s, CAST(:r AS jsonb)) RETURNING id, created_at"""),
        {"o": str(org_id), "u": str(user_id) if user_id else None, "p": passed, "f": failed, "n": na,
         "s": score, "r": json.dumps(payload, ensure_ascii=False, default=str)}).one()
    recompute(conn, org_id)
    return {"id": run_id.id, "created_at": run_id.created_at, "passed": passed, "failed": failed,
            "not_applicable": na, "structure_score": score, "results": payload}


def latest_run(conn: Connection, org_id: UUID | str) -> dict | None:
    r = conn.execute(text("""SELECT id, created_at, passed, failed, not_applicable, structure_score, results
                             FROM gov_check_runs WHERE org_id = :o ORDER BY created_at DESC LIMIT 1"""),
                     {"o": str(org_id)}).mappings().one_or_none()
    if not r:
        return None
    d = dict(r)
    d["structure_score"] = float(d["structure_score"]) if d["structure_score"] is not None else None
    return d


# ------------------------------------------------------------------ الالتزامات
def sync_obligations(conn: Connection, org_id: UUID | str) -> None:
    """يضيف الالتزامات المنطبقة (AUTO) ويحذف التلقائية المعلقة التي لم تعد تنطبق.

    ما عدّله المستخدم يدوياً (source=MANUAL) لا يُمس.
    """
    o = {"o": str(org_id)}
    org = _org(conn, org_id)
    prof = get_profile(conn, org_id)
    ctx = {"legal_type": org["entity_legal_type"], "employees_count": prof["employees_count"],
           "processes_personal_data": prof["processes_personal_data"], "vat_registered": prof["vat_registered"],
           "industry": org["industry_type"]}
    catalog = conn.execute(text("SELECT code, applies FROM obligation_catalog WHERE is_visible")).mappings().all()
    applicable = {c["code"] for c in catalog if applies_to(c["applies"] or {}, ctx)[0]}
    have = {r.code: r for r in conn.execute(text("SELECT code, status, source FROM org_obligations WHERE org_id = :o"), o)}
    for code in applicable - have.keys():
        conn.execute(text("INSERT INTO org_obligations (org_id, code) VALUES (:o, :c) ON CONFLICT DO NOTHING"), {**o, "c": code})
    for code, r in have.items():
        if code not in applicable and r.source == "AUTO" and r.status == "PENDING":
            conn.execute(text("DELETE FROM org_obligations WHERE org_id = :o AND code = :c"), {**o, "c": code})


def list_obligations(conn: Connection, org_id: UUID | str) -> list[dict]:
    """الالتزامات مع الحالة الفعلية: ما يتابعه حصيف من تراخيص وسياسات يُحتسب تلقائياً."""
    o = {"o": str(org_id)}
    org = _org(conn, org_id)
    prof = get_profile(conn, org_id)
    ctx = {"legal_type": org["entity_legal_type"], "employees_count": prof["employees_count"],
           "processes_personal_data": prof["processes_personal_data"], "vat_registered": prof["vat_registered"],
           "industry": org["industry_type"]}
    rows = conn.execute(text("""
        SELECT c.code, c.kind, c.domain, c.title, c.description, c.authority, c.legal_reference, c.source_url,
               c.frequency, c.risk_level, c.compliance_category, c.policy_type, c.applies, c.review_status, c.sort,
               oo.status, oo.source, oo.note, oo.updated_at
        FROM org_obligations oo JOIN obligation_catalog c ON c.code = oo.code
        WHERE oo.org_id = :o AND c.is_visible
        ORDER BY c.sort"""), o).mappings().all()
    items = {r.category: r for r in conn.execute(text("""
        SELECT DISTINCT ON (category) category, status, expiry_date, title FROM v_compliance_items
        WHERE org_id = :o ORDER BY category, expiry_date DESC"""), o)}
    policies = {r for (r,) in conn.execute(text("""SELECT DISTINCT policy_type FROM v_internal_policies
                                                   WHERE org_id = :o AND status = 'ACTIVE'"""), o)}
    out = []
    for r in rows:
        d = dict(r)
        d["needs_confirmation"] = applies_to(d.pop("applies") or {}, ctx)[1]
        d["tracked"] = None
        eff = d["status"]
        if d["status"] == "PENDING":
            it = items.get(d["compliance_category"]) if d["compliance_category"] else None
            if it is not None:
                d["tracked"] = {"type": "ITEM", "title": it.title, "status": it.status, "expiry_date": it.expiry_date}
                eff = "AT_RISK" if it.status == "EXPIRED" else "IN_PLACE"
            elif d["policy_type"] and d["policy_type"] in policies:
                d["tracked"] = {"type": "POLICY"}
                eff = "IN_PLACE"
        d["effective_status"] = eff
        out.append(d)
    return out
