"""التحقق من مخرجات النموذج (منطق نقي، بلا اعتماديات خارجية).

التعليمات وحدها لا تمنع الهلوسة. هنا نفرض برمجياً:
  * المخرجات JSON صالح بالبنية المطلوبة؛
  * كل مادة نظامية مذكورة موجودة فعلاً ضمن ما استرجعناه للنموذج، وإلا تُحوَّل
    الملاحظة إلى "تنبيه" بلا مادة وتُسجَّل كهلوسة مرصودة؛
  * عدد المخالفات والحكم يُحسبان هنا لا يؤخذان من النموذج؛
  * القيم المحجوبة تُعاد للنصوص المعروضة للعميل فقط.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field

from ..domain.pii import restore

DISCLAIMER = "تحليل استرشادي آلي لا يُغني عن الاستشارة القانونية المرخّصة."

_VALID_SEVERITY = {"VIOLATION", "WARNING"}
_TEXT_FIELDS = ("clause_title", "clause_extracted_text", "explanation", "suggested_compliant_clause")


class InvalidModelOutput(ValueError):
    pass


@dataclass
class ValidatedAudit:
    document_type: str
    compliance_percentage: int
    verdict: str
    findings: list[dict]
    violations_count: int
    warnings_count: int
    dropped_citations: list[str] = field(default_factory=list)   # مواد اخترعها النموذج
    disclaimer: str = DISCLAIMER


def _extract_json(raw: str) -> dict:
    raw = raw.strip()
    fenced = re.search(r"```(?:json)?\s*(\{.*\})\s*```", raw, re.DOTALL)
    if fenced:
        raw = fenced.group(1)
    else:
        start, end = raw.find("{"), raw.rfind("}")
        if start == -1 or end <= start:
            raise InvalidModelOutput("no JSON object in model output")
        raw = raw[start:end + 1]
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as e:
        raise InvalidModelOutput(f"malformed JSON: {e}") from e
    if not isinstance(data, dict):
        raise InvalidModelOutput("top-level JSON must be an object")
    return data


def _verdict(violations: int, pct: int) -> str:
    if violations == 0:
        return "COMPLIANT"
    if pct < 50 or violations >= 5:
        return "HIGH_RISK"
    return "CONTAINS_VIOLATIONS"


def validate_audit_output(raw: str, *, retrieved_ids: set[str], pii_mapping: dict[str, str]) -> ValidatedAudit:
    data = _extract_json(raw)

    findings_in = data.get("findings")
    if not isinstance(findings_in, list):
        raise InvalidModelOutput("'findings' must be a list")

    try:
        pct = int(data.get("compliance_percentage", 0))
    except (TypeError, ValueError) as e:
        raise InvalidModelOutput("compliance_percentage must be a number") from e
    pct = max(0, min(100, pct))

    findings: list[dict] = []
    dropped: list[str] = []
    for f in findings_in:
        if not isinstance(f, dict):
            continue
        law_id = f.get("violated_law_id")
        severity = f.get("severity") if f.get("severity") in _VALID_SEVERITY else "WARNING"
        if law_id is not None:
            law_id = str(law_id)
            if law_id not in retrieved_ids:
                # المادة غير موجودة في السياق: لا نعرضها كمخالفة نظامية.
                dropped.append(law_id)
                law_id, severity = None, "WARNING"
        elif severity == "VIOLATION":
            severity = "WARNING"     # مخالفة بلا سند نظامي تُعرض كتنبيه
        clean = {k: restore(str(f.get(k) or ""), pii_mapping) for k in _TEXT_FIELDS}
        clean.update(severity=severity, violated_law_id=law_id)
        findings.append(clean)

    violations = sum(1 for f in findings if f["severity"] == "VIOLATION")
    warnings = len(findings) - violations
    if violations == 0 and pct < 100 and not warnings:
        pct = 100                  # لا ملاحظات إطلاقاً ← لا معنى لنسبة ناقصة
    return ValidatedAudit(
        document_type=str(data.get("document_type") or "UNKNOWN"),
        compliance_percentage=pct,
        verdict=_verdict(violations, pct),
        findings=findings,
        violations_count=violations,
        warnings_count=warnings,
        dropped_citations=dropped,
    )
