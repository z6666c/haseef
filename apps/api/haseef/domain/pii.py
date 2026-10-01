"""حجب البيانات الشخصية قبل إرسال أي نص لنموذج لغوي.

حصيف تدقّق امتثال عملائها لنظام حماية البيانات، فيجب أن تلتزم به أولاً: عقود العمل
تحوي أرقام هويات وحسابات بنكية وجوالات. نستبدلها برموز ثابتة ([NATIONAL_ID_1]...)
قبل الإرسال، ثم نعيدها في النتائج المعروضة للعميل فقط.

الحدود المعروفة: الأسماء الشخصية والعناوين النصية لا تُكتشف بالأنماط؛ تحتاج
نموذج تعرّف كيانات (NER) محلياً في مرحلة لاحقة.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

from .arabic import normalize_digits

# الترتيب مهم: الآيبان قبل الهوية لأنه يحتوي أرقاماً طويلة.
_PATTERNS: list[tuple[str, re.Pattern[str]]] = [
    ("IBAN", re.compile(r"\bSA\d{2}(?:\s?[0-9A-Z]{4}){5}\b", re.IGNORECASE)),
    ("EMAIL", re.compile(r"\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b")),
    ("PHONE", re.compile(r"(?<!\d)(?:\+966|00966|0)\s?5\d(?:[\s-]?\d){7}(?!\d)")),
    ("NATIONAL_ID", re.compile(r"(?<!\d)[12]\d{9}(?!\d)")),   # هوية وطنية (1) أو إقامة (2)
]


@dataclass
class RedactionResult:
    text: str
    mapping: dict[str, str] = field(default_factory=dict)   # الرمز ← القيمة الأصلية

    @property
    def counts(self) -> dict[str, int]:
        out: dict[str, int] = {}
        for token in self.mapping:
            kind = token.strip("[]").rsplit("_", 1)[0]
            out[kind] = out.get(kind, 0) + 1
        return out


def redact(text: str) -> RedactionResult:
    text = normalize_digits(text)
    mapping: dict[str, str] = {}
    seen: dict[str, str] = {}          # نفس القيمة ← نفس الرمز
    counters: dict[str, int] = {}

    for kind, pattern in _PATTERNS:
        def repl(m: re.Match[str], kind: str = kind) -> str:
            value = m.group(0)
            if value in seen:
                return seen[value]
            counters[kind] = counters.get(kind, 0) + 1
            token = f"[{kind}_{counters[kind]}]"
            seen[value] = token
            mapping[token] = value
            return token
        text = pattern.sub(repl, text)
    return RedactionResult(text=text, mapping=mapping)


def restore(text: str, mapping: dict[str, str]) -> str:
    for token, value in mapping.items():
        text = text.replace(token, value)
    return text
