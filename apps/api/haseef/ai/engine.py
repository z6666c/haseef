"""مسار تدقيق الوثيقة: حجب ← استرجاع ← نموذج ← تحقق ← إعادة القيم ← حفظ وتسجيل التكلفة.

العميل يتصل بنقطة نهاية متوافقة مع واجهة OpenAI (chat/completions و embeddings)،
وهي الواجهة التي تعرضها معظم خوادم النماذج المستضافة ذاتياً (vLLM، TGI، ...)
وكثير من المزوّدين. الشرط الوحيد: أن تكون مستضافة داخل المملكة (الوثيقة §1.1).
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from typing import Protocol
from uuid import UUID

import httpx
from sqlalchemy import Connection, text

from ..config import Settings
from ..domain.pii import redact
from .prompt import SYSTEM_PROMPT, build_user_message
from .validation import InvalidModelOutput, validate_audit_output

log = logging.getLogger(__name__)

# استعلامات تركيز لكل نوع وثيقة، تُضاف لاستعلام نص الوثيقة نفسه لتحسين الاسترجاع.
FOCUS_QUERIES = {
    "LABOR_CONTRACT": ["فترة التجربة في عقد العمل", "شرط عدم المنافسة بعد انتهاء العقد",
                       "ساعات العمل والعمل الإضافي", "الإجازة السنوية", "مكافأة نهاية الخدمة"],
    "PDPL_PRIVACY_POLICY": ["الغرض من جمع البيانات الشخصية", "حقوق صاحب البيانات الشخصية",
                            "الإفصاح عن البيانات لأطراف ثالثة", "نقل البيانات خارج المملكة",
                            "سياسة الخصوصية"],
    "VENDOR_AGREEMENT": ["معالجة البيانات بواسطة جهة معالجة", "السرية"],
    "INTERNAL_POLICY": ["الحوكمة وتعارض المصالح"],
}
AUTHORITIES = {
    "LABOR_CONTRACT": ["LABOR_LAW", "LABOR_LAW_REGS"],
    "PDPL_PRIVACY_POLICY": ["PDPL", "PDPL_REGS"],
    "VENDOR_AGREEMENT": ["PDPL", "PDPL_REGS", "COMPANIES_LAW"],
    "INTERNAL_POLICY": ["COMPANIES_LAW", "PDPL", "LABOR_LAW"],
}


@dataclass
class LLMResponse:
    text: str
    input_tokens: int
    output_tokens: int


class LLMClient(Protocol):
    provider: str
    model: str
    region: str | None
    def complete(self, system: str, user: str) -> LLMResponse: ...
    def embed(self, texts: list[str]) -> list[list[float]]: ...


class OpenAICompatibleClient:
    provider = "openai_compatible"

    def __init__(self, base_url: str, api_key: str | None, model: str, embedding_model: str,
                 region: str | None, client: httpx.Client | None = None):
        self._base = base_url.rstrip("/")
        self._headers = {"Authorization": f"Bearer {api_key}"} if api_key else {}
        self.model, self.embedding_model, self.region = model, embedding_model, region
        self._client = client or httpx.Client(timeout=120)

    def complete(self, system: str, user: str) -> LLMResponse:
        r = self._client.post(f"{self._base}/chat/completions", headers=self._headers, json={
            "model": self.model, "temperature": 0,
            "response_format": {"type": "json_object"},
            "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
        })
        r.raise_for_status()
        body = r.json()
        usage = body.get("usage", {})
        return LLMResponse(body["choices"][0]["message"]["content"],
                           usage.get("prompt_tokens", 0), usage.get("completion_tokens", 0))

    def embed(self, texts: list[str]) -> list[list[float]]:
        r = self._client.post(f"{self._base}/embeddings", headers=self._headers,
                              json={"model": self.embedding_model, "input": texts})
        r.raise_for_status()
        return [d["embedding"] for d in sorted(r.json()["data"], key=lambda d: d["index"])]


def build_llm(s: Settings) -> LLMClient | None:
    if s.llm_provider == "disabled":
        return None
    if not (s.llm_base_url and s.llm_model and s.llm_region):
        raise RuntimeError("HASEEF_LLM_BASE_URL و HASEEF_LLM_MODEL و HASEEF_LLM_REGION مطلوبة")
    return OpenAICompatibleClient(s.llm_base_url, s.llm_api_key, s.llm_model, s.embedding_model, s.llm_region)


def _vec(v: list[float]) -> str:
    return "[" + ",".join(f"{x:.6f}" for x in v) + "]"


_RETRIEVE = text("""
    SELECT k.id::text AS id, s.authority, k.article_number, k.title, k.content_chunk
    FROM regulatory_knowledge k JOIN regulatory_sources s ON s.id = k.source_id
    WHERE s.is_active AND k.embedding IS NOT NULL AND s.authority = ANY(:auths)
    ORDER BY k.embedding <=> CAST(:q AS vector)
    LIMIT :k
""")


def retrieve(conn: Connection, llm: LLMClient, category: str, document_text: str, per_query: int = 4) -> list[dict]:
    queries = [document_text[:2000], *FOCUS_QUERIES.get(category, [])]
    vectors = llm.embed(queries)
    seen: dict[str, dict] = {}
    for v in vectors:
        for row in conn.execute(_RETRIEVE, {"auths": AUTHORITIES.get(category, []), "q": _vec(v), "k": per_query}).mappings():
            seen.setdefault(row["id"], dict(row))
    return list(seen.values())[:16]


# تكلفة تقديرية لكل مليون توكن بالريال؛ تُضبط حسب عقد المزوّد الفعلي.
COST_PER_M_INPUT_SAR = 3.75
COST_PER_M_OUTPUT_SAR = 15.0


def run_audit(conn: Connection, *, org_id: UUID, audit_id: UUID, category: str,
              document_text: str, llm: LLMClient) -> None:
    """يُنفَّذ داخل معاملة المنشأة (RLS) من عامل Celery."""
    conn.execute(text("UPDATE contract_audits SET status='PROCESSING' WHERE id=:id"), {"id": audit_id})

    red = redact(document_text)
    articles = retrieve(conn, llm, category, red.text)
    resp = llm.complete(SYSTEM_PROMPT, build_user_message(red.text, articles))

    try:
        result = validate_audit_output(resp.text, retrieved_ids={a["id"] for a in articles},
                                       pii_mapping=red.mapping)
    except InvalidModelOutput as e:
        conn.execute(text("UPDATE contract_audits SET status='FAILED', error=:e WHERE id=:id"),
                     {"id": audit_id, "e": str(e)})
        raise

    if result.dropped_citations:
        log.warning("audit %s: model cited %d articles outside context", audit_id, len(result.dropped_citations))

    by_id = {a["id"]: a for a in articles}
    for f in result.findings:     # اسم المادة ونصها من قاعدة المعرفة، لا من النموذج
        if f["violated_law_id"]:
            a = by_id[f["violated_law_id"]]
            f["law"] = {"authority": a["authority"], "article_number": a["article_number"], "title": a["title"]}

    cost = (resp.input_tokens * COST_PER_M_INPUT_SAR + resp.output_tokens * COST_PER_M_OUTPUT_SAR) / 1_000_000
    conn.execute(text("""
        UPDATE contract_audits SET status='COMPLETED', completed_at=now(), verdict=:v,
            compliance_percentage=:p, findings=CAST(:f AS jsonb), pii_redacted=true,
            model_provider=:prov, model_name=:model, model_region=:region,
            knowledge_snapshot=CAST(:snap AS jsonb)
        WHERE id=:id"""), {
        "id": audit_id, "v": result.verdict, "p": result.compliance_percentage,
        "f": json.dumps({"findings": result.findings, "violations_count": result.violations_count,
                         "warnings_count": result.warnings_count, "disclaimer": result.disclaimer,
                         "redacted_counts": red.counts}, ensure_ascii=False),
        "prov": llm.provider, "model": llm.model, "region": llm.region,
        "snap": json.dumps({"article_ids": list(by_id), "dropped_citations": result.dropped_citations}),
    })
    conn.execute(text("""
        INSERT INTO ai_usage_ledger (org_id, feature, audit_id, provider, model, input_tokens, output_tokens, cost_sar)
        VALUES (:o, :feat, :a, :prov, :model, :i, :out, :c)"""), {
        "o": org_id, "feat": "PRIVACY_AUDIT" if category == "PDPL_PRIVACY_POLICY" else "CONTRACT_AUDIT",
        "a": audit_id, "prov": llm.provider, "model": llm.model,
        "i": resp.input_tokens, "out": resp.output_tokens, "c": round(cost, 4),
    })
