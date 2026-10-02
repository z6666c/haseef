"""التقرير السنوي لمجلس الإدارة / الشركاء (باقة كبار العملاء).

يُجمَّع من بيانات المنشأة الفعلية لسنة محددة، ويمكن حفظ لقطة منه (للأرشيف ولما عُرض على المجلس).
الطباعة إلى PDF تتم من المتصفح (تنسيق طباعة مخصص في الواجهة).
"""

from __future__ import annotations

import json
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import Connection, text

from ..deps import Tenant, get_tenant
from ..services import governance_service as gs
from ..services.entitlements import org_plan, require_feature
from .compliance import _audit

router = APIRouter(prefix="/reports", tags=["reports"])

SEV_RANK = {"critical": 0, "high": 1, "medium": 2, "CRITICAL": 0, "HIGH": 1, "MEDIUM": 2}


def build_board_report(c: Connection, org_id, year: int) -> dict:
    o = {"o": str(org_id), "ystart": date(year, 1, 1), "yend": date(year + 1, 1, 1)}
    org = c.execute(text("""SELECT name, cr_number, entity_legal_type, industry_type, commercial_size,
                                   haseef_score, score_breakdown, score_computed_at
                            FROM organizations WHERE id = :o"""), o).mappings().one()
    plan = org_plan(c, org_id)
    bd = org["score_breakdown"] or {}

    # الهيكل وفحص الحوكمة
    structure = gs.structure(c, org_id)
    run = gs.latest_run(c, org_id)
    failed = [r for r in (run["results"] if run else []) if r["status"] == "FAIL"]
    failed.sort(key=lambda r: (r["level"] != "MANDATORY", SEV_RANK.get(r["severity"], 9)))

    # القرارات والاجتماعات خلال السنة
    res = c.execute(text("""SELECT title, resolution_type, meeting_date, status FROM governance_resolutions
                            WHERE org_id = :o AND meeting_date >= :ystart AND meeting_date < :yend
                            ORDER BY meeting_date"""), o).mappings().all()
    by_type: dict[str, int] = {}
    for r in res:
        by_type[r["resolution_type"]] = by_type.get(r["resolution_type"], 0) + 1
    meetings = []
    for b in structure:
        if b["meetings_per_year"]:
            held = sum(1 for r in res if (b["body_type"] == "BOARD" and r["resolution_type"] == "BOARD_DECISION")
                       or (b["body_type"] in ("GENERAL_ASSEMBLY",) and r["resolution_type"] in ("ORDINARY_ASSEMBLY", "EXTRAORDINARY_ASSEMBLY"))
                       or (b["body_type"] == "PARTNERS_ASSEMBLY" and r["resolution_type"] == "PARTNERS_DECISION"))
            meetings.append({"body": b["name"], "body_type": b["body_type"], "required": b["meetings_per_year"],
                             "held": held if b["body_type"] in ("BOARD", "GENERAL_ASSEMBLY", "PARTNERS_ASSEMBLY") else None})

    # الامتثال التشغيلي
    items = c.execute(text("""SELECT count(*) FILTER (WHERE status = 'ACTIVE') AS active,
                                     count(*) FILTER (WHERE status = 'EXPIRING_SOON') AS expiring,
                                     count(*) FILTER (WHERE status = 'EXPIRED') AS expired, count(*) AS total
                              FROM v_compliance_items WHERE org_id = :o"""), o).mappings().one()
    renewed = c.execute(text("""SELECT count(*) FROM compliance_items WHERE org_id = :o
                                AND archived_at >= :ystart AND archived_at < :yend"""), o).scalar_one()
    expired_list = [dict(r) for r in c.execute(text("""SELECT title, expiry_date, risk_level FROM v_compliance_items
        WHERE org_id = :o AND status IN ('EXPIRED','EXPIRING_SOON') ORDER BY expiry_date LIMIT 10"""), o).mappings()]

    # السياسات والالتزامات
    pol = c.execute(text("""SELECT count(*) FILTER (WHERE status = 'ACTIVE') AS active,
                                   count(*) FILTER (WHERE effective_status = 'OVERDUE_REVIEW') AS overdue,
                                   count(*) FILTER (WHERE effective_status = 'NEEDS_REVIEW') AS needs_review,
                                   count(*) FILTER (WHERE status = 'DRAFT') AS drafts,
                                   count(*) FILTER (WHERE approval_date >= :ystart AND approval_date < :yend) AS approved_in_year
                            FROM v_internal_policies WHERE org_id = :o"""), o).mappings().one()
    obligations = gs.list_obligations(c, org_id)
    ob_counts = {"total": len(obligations)}
    for ob in obligations:
        k = ob.get("effective_status") or ob.get("status")
        ob_counts[k] = ob_counts.get(k, 0) + 1
    ob_pending = sorted([ob for ob in obligations if (ob.get("effective_status") or ob.get("status")) in ("PENDING", "AT_RISK")],
                        key=lambda x: SEV_RANK.get(x["risk_level"], 9))[:10]

    # حماية البيانات الشخصية
    pdpl = {
        "records": c.execute(text("SELECT count(*) FROM pdpl_data_records WHERE org_id = :o"), o).scalar_one(),
        "requests": dict(c.execute(text("""SELECT count(*) AS total,
                count(*) FILTER (WHERE status IN ('COMPLETED','REJECTED') AND completed_on <= due_on) AS on_time,
                count(*) FILTER (WHERE status IN ('OPEN','IN_PROGRESS')) AS open
            FROM pdpl_requests WHERE org_id = :o AND received_on >= :ystart AND received_on < :yend"""), o).mappings().one()),
        "incidents": dict(c.execute(text("""SELECT count(*) AS total,
                count(*) FILTER (WHERE authority_notified_at IS NOT NULL
                                 AND authority_notified_at <= discovered_at + interval '72 hours') AS notified_in_time,
                count(*) FILTER (WHERE harm_likely) AS harm_likely,
                count(*) FILTER (WHERE status <> 'CLOSED') AS open
            FROM pdpl_incidents WHERE org_id = :o AND discovered_at >= :ystart AND discovered_at < :yend"""), o).mappings().one()),
        "dpia": dict(c.execute(text("""SELECT count(*) AS total, count(*) FILTER (WHERE status = 'APPROVED') AS approved,
                count(*) FILTER (WHERE residual_level IN ('HIGH','CRITICAL')) AS high_residual
            FROM dpia_assessments WHERE org_id = :o"""), o).mappings().one()),
    }
    legal = dict(c.execute(text("""SELECT count(*) FILTER (WHERE status = 'COMPLETED') AS completed,
                                          count(*) FILTER (WHERE status IN ('REQUESTED','CONFIRMED')) AS open
                                   FROM legal_consultations WHERE org_id = :o AND created_at >= :ystart AND created_at < :yend"""),
                           o).mappings().one())

    # التوصيات: أعلى أولوية أولاً، بلا تكرار
    recs: list[dict] = []
    for r in failed[:6]:
        recs.append({"priority": r["severity"].upper(), "area": "الحوكمة", "text": f"{r['title']}: {r['message']}"})
    for x in ob_pending[:4]:
        recs.append({"priority": x["risk_level"], "area": "الالتزامات", "text": f"استكمال: {x['title']}"})
    for x in expired_list:
        if x["risk_level"] in ("CRITICAL", "HIGH"):
            recs.append({"priority": x["risk_level"], "area": "التراخيص", "text": f"تجديد {x['title']} (ينتهي/انتهى {x['expiry_date']})"})
    if pol["overdue"]:
        recs.append({"priority": "HIGH", "area": "السياسات", "text": f"مراجعة {pol['overdue']} سياسة تجاوزت موعد مراجعتها"})
    if pdpl["dpia"]["high_residual"]:
        recs.append({"priority": "HIGH", "area": "حماية البيانات", "text": "معالجة الخطر المتبقي المرتفع في تقييمات الأثر"})
    recs.sort(key=lambda r: SEV_RANK.get(r["priority"], 9))

    return {
        "year": year, "generated_on": gs.riyadh_today(),
        "org": {k: org[k] for k in ("name", "cr_number", "entity_legal_type", "industry_type", "commercial_size")},
        "plan": {"tier": plan["plan_tier"], "name": plan["plan_name"]},
        "score": {"value": org["haseef_score"], "pillars": bd.get("pillars", {}), "reasons": bd.get("reasons", [])[:8],
                  "computed_at": org["score_computed_at"]},
        "structure": [{"name": b["name"], "body_type": b["body_type"], "meetings_per_year": b["meetings_per_year"],
                       "members": [{"full_name": m["full_name"], "position": m["position"], "is_independent": m["is_independent"],
                                    "is_executive": m["is_executive"], "term_ends_on": m["term_ends_on"]} for m in b["members"]]}
                      for b in structure],
        "governance_check": {"structure_score": run["structure_score"] if run else None,
                             "passed": run["passed"] if run else 0, "failed": run["failed"] if run else 0,
                             "run_at": run["created_at"] if run else None,
                             "failed_items": [{k: r[k] for k in ("code", "title", "message", "severity", "level")} for r in failed[:12]]},
        "resolutions": {"total": len(res), "by_type": by_type,
                        "list": [dict(r) for r in res][:30]},
        "meetings": meetings,
        "compliance": {**dict(items), "renewed_in_year": renewed, "attention": expired_list},
        "policies": dict(pol),
        "obligations": {"counts": ob_counts, "pending": [{"title": x["title"], "risk_level": x["risk_level"],
                                                         "authority": x.get("authority")} for x in ob_pending]},
        "pdpl": pdpl,
        "legal": legal,
        "recommendations": recs[:12],
    }


@router.get("/board")
def board_report(year: int = Query(default_factory=lambda: gs.riyadh_today().year, ge=2020, le=2100),
                 t: Tenant = Depends(get_tenant)):
    require_feature(t.conn, t.org_id, "BOARD_REPORTS")
    saved = t.conn.execute(text("""SELECT b.snapshot, b.notes, b.saved_at, u.full_name AS saved_by_name
                                   FROM board_reports b LEFT JOIN users u ON u.id = b.saved_by
                                   WHERE b.year = :y"""), {"y": year}).mappings().one_or_none()
    years = [y for (y,) in t.conn.execute(text("SELECT year FROM board_reports ORDER BY year DESC"))]
    return {"live": build_board_report(t.conn, t.org_id, year),
            "saved": dict(saved) if saved else None, "saved_years": years}


class SaveIn(BaseModel):
    notes: str | None = Field(default=None, max_length=8000)


@router.put("/board/{year}")
def save_board_report(year: int, body: SaveIn, t: Tenant = Depends(get_tenant)):
    t.require("ORG_ADMIN", "COMPLIANCE_OFFICER")
    require_feature(t.conn, t.org_id, "BOARD_REPORTS")
    if not 2020 <= year <= gs.riyadh_today().year:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "سنة غير صالحة")
    snap = build_board_report(t.conn, t.org_id, year)
    t.conn.execute(text("""
        INSERT INTO board_reports (org_id, year, snapshot, notes, saved_by)
        VALUES (:o, :y, CAST(:s AS jsonb), :n, :u)
        ON CONFLICT (org_id, year) DO UPDATE SET snapshot = EXCLUDED.snapshot, notes = EXCLUDED.notes,
            saved_by = EXCLUDED.saved_by, saved_at = now()"""),
        {"o": t.org_id, "y": year, "s": json.dumps(snap, ensure_ascii=False, default=str), "n": body.notes,
         "u": t.principal.user_id})
    _audit(t.conn, t, "BOARD_REPORT_SAVE", "board_report", None, {"year": year})
    return {"saved": True}
