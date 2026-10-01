"""مزامنة المحتوى الأولي (المعايير، الالتزامات، المكتبة) مع قاعدة البيانات.

تُضيف الرموز الجديدة فقط (ON CONFLICT DO NOTHING): أي تعديل أو إخفاء أو اعتماد قام به
فريق حصيف من لوحة التحكم لا يُمس عند إعادة التشغيل أو التحديث.
"""

from __future__ import annotations

import json

from sqlalchemy import Connection, text

from ..content.library import GUIDES, LAWS, TEMPLATES
from ..content.obligations import OBLIGATIONS
from ..content.standards import STANDARDS

_STD = text("""
    INSERT INTO gov_standards (code, domain, title, description, legal_reference, source_url, level, severity,
                               applies_legal_types, rule, sort)
    VALUES (:code, :domain, :title, :description, :reference, :url, :level, :severity, :applies, CAST(:rule AS jsonb), :sort)
    ON CONFLICT (code) DO NOTHING""")

_OBL = text("""
    INSERT INTO obligation_catalog (code, kind, domain, title, description, authority, legal_reference, source_url,
                                    frequency, risk_level, compliance_category, policy_type, applies, sort)
    VALUES (:code, :kind, :domain, :title, :description, :authority, :reference, :url,
            :frequency, :risk, :category, :policy_type, CAST(:applies AS jsonb), :sort)
    ON CONFLICT (code) DO NOTHING""")

_LIB = text("""
    INSERT INTO library_documents (slug, kind, category, title, summary, body_md, url, policy_type,
                                   applies_legal_types, related_codes, sort)
    VALUES (:slug, :kind, :category, :title, :summary, :body, :url, :policy_type, :applies, :related, :sort)
    ON CONFLICT (slug) DO NOTHING""")


def sync_catalog(conn: Connection) -> dict[str, int]:
    """يُستدعى باتصال المنصة. يرجع عدد العناصر المضافة لكل كتالوج."""
    added = {"standards": 0, "obligations": 0, "library": 0}
    for s in STANDARDS:
        added["standards"] += conn.execute(_STD, {**s, "rule": json.dumps(s["rule"])}).rowcount
    for o in OBLIGATIONS:
        added["obligations"] += conn.execute(_OBL, {"policy_type": None, **o, "applies": json.dumps(o["applies"])}).rowcount
    sort = 10
    for kind, docs in (("TEMPLATE", TEMPLATES), ("GUIDE", GUIDES), ("LAW", LAWS)):
        for d in docs:
            added["library"] += conn.execute(_LIB, {
                "slug": d["slug"], "kind": kind, "category": d["category"], "title": d["title"],
                "summary": d.get("summary"), "body": d.get("body"), "url": d.get("url"),
                "policy_type": d.get("policy_type"), "applies": d.get("applies", []),
                "related": d.get("related", []), "sort": sort,
            }).rowcount
            sort += 10
    return added
