"""يصدّر المحتوى المرجعي ونتيجة فحص لمنشأة تجريبية إلى JSON لنسخة العرض (GitHub Pages).

    python3 apps/api/scripts/export_demo_content.py > packages/shared/src/demo-content.json
لا يحتاج قاعدة بيانات ولا مكتبات خارجية.
"""

from __future__ import annotations

import json
import sys
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from haseef.content.library import GUIDES, LAWS, TEMPLATES  # noqa: E402
from haseef.content.obligations import OBLIGATIONS, applies_to  # noqa: E402
from haseef.content.pdpl import ROPA_TEMPLATES  # noqa: E402
from haseef.content.examples import EXAMPLES, PROFILE as EX_PROFILE  # noqa: E402
from haseef.content.standards import STANDARDS, STRUCTURE_TEMPLATES  # noqa: E402
from haseef.domain.governance_check import Body, Member, OrgContext, run_check  # noqa: E402

LEGAL = "LLC"
ORG = {"legal_type": LEGAL, "employees_count": 18, "processes_personal_data": True, "vat_registered": True, "industry": "المقاولات"}

library = []
for kind, docs in (("TEMPLATE", TEMPLATES), ("GUIDE", GUIDES), ("LAW", LAWS)):
    for d in docs:
        library.append({"id": d["slug"], "kind": kind, "category": d["category"], "title": d["title"], "summary": d.get("summary"),
                        "url": d.get("url"), "file_name": None, "file_mime": None, "file_size": None,
                        "policy_type": d.get("policy_type"), "applies_legal_types": d.get("applies", []),
                        "related_codes": d.get("related", []), "review_status": "DRAFT", "version": "1.0",
                        "updated_at": "2026-10-01T00:00:00Z", "body_md": d.get("body")})

def _bodies(spec):
    out = []
    for i, (bt, name, mandate, meetings, members) in enumerate(spec):
        out.append({"id": f"b-{i}", "body_type": bt, "name": name, "mandate": mandate or None, "meetings_per_year": meetings,
                    "sort": (i + 1) * 10, "from_template": True,
                    "members": [{"id": f"m-{i}-{j}", "full_name": n, "position": p, "is_independent": ind, "is_executive": ex,
                                 "appointed_on": a.isoformat() if a else None, "term_ends_on": t.isoformat() if t else None}
                                for j, (n, p, ind, ex, a, t) in enumerate(members)]})
    return out


bodies = _bodies(EXAMPLES[LEGAL]["bodies"])
profile = {k: (v.isoformat() if isinstance(v, date) else v) for k, v in EX_PROFILE.items()}

stds = [{**s, "applies_legal_types": s["applies"]} for s in STANDARDS]
ctx = OrgContext(legal_type=LEGAL, size="SMALL", profile=EX_PROFILE,
                 bodies=[Body(b["body_type"], b["name"], [Member(m["full_name"], m["position"], m["is_independent"], m["is_executive"],
                                                                 date.fromisoformat(m["term_ends_on"]) if m["term_ends_on"] else None)
                                                          for m in b["members"]]) for b in bodies],
                 active_policy_types={"CONFLICT_OF_INTEREST", "PRIVACY_POLICY"}, ropa_count=0, doa_count=0, today=date(2026, 10, 2))
results, score = run_check(stds, ctx)
by = {s["code"]: s for s in STANDARDS}
check = {"id": "run-1", "created_at": "2026-10-02T06:00:00Z", "passed": sum(r.status == "PASS" for r in results),
         "failed": sum(r.status == "FAIL" for r in results), "not_applicable": sum(r.status == "NA" for r in results),
         "structure_score": score,
         "results": [{**r.as_dict(), "description": by[r.code]["description"], "legal_reference": by[r.code]["reference"],
                      "source_url": by[r.code]["url"], "review_status": "DRAFT"} for r in results]}

tracked_cats = {"COMMERCIAL_REG", "BALADY", "CHI_INSURANCE", "CIVIL_DEFENSE", "QIWA_NITAQAT", "ZATCA"}
obligations = []
for o in OBLIGATIONS:
    ok, unsure = applies_to(o["applies"], ORG)
    if not ok:
        continue
    tracked = None
    eff = "PENDING"
    if o.get("category") in tracked_cats:
        tracked, eff = {"type": "ITEM", "title": o["title"], "status": "ACTIVE"}, "IN_PLACE"
    elif o.get("policy_type") == "CONFLICT_OF_INTEREST":
        tracked, eff = {"type": "POLICY"}, "IN_PLACE"
    obligations.append({"code": o["code"], "kind": o["kind"], "domain": o["domain"], "title": o["title"],
                        "description": o["description"], "authority": o["authority"], "legal_reference": o["reference"],
                        "source_url": o["url"], "frequency": o["frequency"], "risk_level": o["risk"],
                        "compliance_category": o.get("category"), "policy_type": o.get("policy_type"),
                        "review_status": "DRAFT", "status": "PENDING", "source": "AUTO", "note": None,
                        "needs_confirmation": unsure, "tracked": tracked, "effective_status": eff})

admin_standards = [{"code": s["code"], "domain": s["domain"], "title": s["title"], "description": s["description"],
                    "legal_reference": s["reference"], "source_url": s["url"], "level": s["level"], "severity": s["severity"],
                    "applies_legal_types": s["applies"], "rule": s["rule"], "is_visible": True, "review_status": "DRAFT",
                    "sort": s["sort"], "updated_at": "2026-10-01T00:00:00Z"} for s in STANDARDS]
admin_obligations = [{"code": o["code"], "kind": o["kind"], "domain": o["domain"], "title": o["title"], "description": o["description"],
                      "authority": o["authority"], "legal_reference": o["reference"], "source_url": o["url"], "frequency": o["frequency"],
                      "risk_level": o["risk"], "applies": o["applies"], "is_visible": True, "review_status": "DRAFT",
                      "orgs": 2, "updated_at": "2026-10-01T00:00:00Z"} for o in OBLIGATIONS]

templates = {lt: _bodies([(bt, n, m, mp, []) for bt, n, m, mp in tpl]) for lt, tpl in STRUCTURE_TEMPLATES.items()}
examples = {lt: {"title": ex["title"], "bodies": _bodies(ex["bodies"])} for lt, ex in EXAMPLES.items()}

json.dump({"library": library, "structure": {"legal_type": LEGAL, "size": "SMALL", "profile": profile, "bodies": bodies,
                                             "latest_check": check, "example_title": EXAMPLES[LEGAL]["title"]},
           "templates": templates, "examples": examples, "check_today": "2026-10-02", "ropa_templates": ROPA_TEMPLATES,
           "obligations": obligations, "admin_standards": admin_standards, "admin_obligations": admin_obligations},
          sys.stdout, ensure_ascii=False, indent=1)
