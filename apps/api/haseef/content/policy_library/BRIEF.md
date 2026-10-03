# Brief for writing Haseef policy-library content

Haseef (حَصيف) is a Saudi GRC SaaS for SMEs and companies. Its reference library offers ready-to-adopt
templates: a company opens one, clicks "adopt", and it becomes the company's policy with «placeholders» to fill.
You write COMPLETE, professional, ready-to-use Arabic documents — as a senior Saudi corporate-governance,
compliance and data-protection expert would. Not outlines. Each document must be usable as-is after filling placeholders.

## Output
Write exactly ONE Python file at the path you are given. It must contain only:

```python
"""<one-line Arabic docstring>"""
from __future__ import annotations

DOCS: list[dict] = [
    dict(slug="tpl-...", category="GOVERNANCE", policy_type="BOARD_CHARTER", applies=[], related=["GOV_BOARD_CHARTER"],
         title="نموذج ...", summary="جملة أو جملتان تصف النموذج ومتى يُستخدم.",
         body=r"""
# ...
"""),
]
```

- Use `r"""..."""` raw triple-quoted strings. NEVER put `"""` inside a body.
- Do NOT append any disclaimer footer; it is added centrally.
- After writing, verify: `cd /home/claude/haseef/apps/api && python3 -c "from haseef.content.policy_library.<module> import DOCS; print(len(DOCS), [len(d['body']) for d in DOCS])"`
  and check every dict has keys slug, category, policy_type, applies, related, title, summary, body, and slugs are unique.
- Do not edit any other file in the repo.

## Allowed values
- category: GOVERNANCE, POLICIES, PDPL, LABOR, TAX, COMMERCIAL, SAFETY, AML
- policy_type (or None for forms/registers/resolutions that are not a standing policy):
  PRIVACY_POLICY, CONFLICT_OF_INTEREST, WHISTLEBLOWING, CODE_OF_CONDUCT, DATA_RETENTION, INFOSEC, BREACH_RESPONSE,
  RELATED_PARTIES, BOARD_CHARTER, AUDIT_COMMITTEE_CHARTER, DISCLOSURE, DOA, RISK_MANAGEMENT, AML, WORK_REGULATION,
  HEALTH_SAFETY, OTHER
- applies: list of legal types the doc is meant for; empty list = all. Legal types:
  SOLE_PROPRIETORSHIP, LLC, SIMPLIFIED_JOINT_STOCK, CLOSED_JOINT_STOCK, PUBLIC_JOINT_STOCK, BRANCH_OF_FOREIGN
- related: codes from these lists (obligations and governance standards) that the doc helps satisfy:
  obligations: CR_ANNUAL_CONFIRMATION, CHAMBER_MEMBERSHIP, UBO_DISCLOSURE, FS_DEPOSIT, BYLAWS_ALIGNMENT, BALADY_LICENSE,
  CIVIL_DEFENSE_CERT, GOSI_REGISTRATION, QIWA_CONTRACTS, WAGE_PROTECTION, NITAQAT, WORK_REGULATION, HEALTH_INSURANCE,
  OHS_POLICY, ZAKAT_RETURN, VAT_REGISTRATION, VAT_RETURNS, E_INVOICING, PDPL_PRIVACY_POLICY, PDPL_ROPA, PDPL_BREACH,
  PDPL_RETENTION, PDPL_SECURITY, PDPL_DPO, GOV_DOA, GOV_CONFLICT_OF_INTEREST, GOV_RELATED_PARTIES, GOV_BOARD_CHARTER,
  GOV_AUDIT_CHARTER, GOV_WHISTLEBLOWING, GOV_DISCLOSURE, GOV_CODE_OF_CONDUCT, AML_PROGRAM
  standards: STR_MANAGEMENT_DEFINED, STR_BYLAWS, STR_UBO, STR_FS_FILED, STR_TERMS_VALID, JSC_BOARD_EXISTS, JSC_BOARD_MIN3,
  BOARD_HAS_CHAIR, PJSC_INDEPENDENTS, CJSC_INDEPENDENTS, PJSC_MAJORITY_NONEXEC, PJSC_CHAIR_NONEXEC, JSC_SECRETARY,
  JSC_AUDIT_COMMITTEE, PJSC_NRC, PJSC_INTERNAL_AUDIT, JSC_AUDITOR, LLC_AUDITOR, JSC_ANNUAL_ASSEMBLY, LLC_ANNUAL_PARTNERS,
  POL_CONFLICT_OF_INTEREST, POL_CONFLICT_OF_INTEREST_REC, POL_RELATED_PARTIES, POL_WHISTLEBLOWING, POL_CODE_OF_CONDUCT,
  POL_DOA, PDPL_PRIVACY_POLICY, PDPL_ROPA, PDPL_BREACH_RESPONSE, PDPL_DPO

## Markdown that renders (anything else shows as plain text)
- Headings `#` to `####`; paragraphs; `**bold**`, `*italic*`; links only `[text](https://...)`.
- Flat bullet lists `- item` and numbered lists `1. item` (NO nesting; no indentation).
- Checkboxes inside list items: `- [ ] item`.
- Tables with a header row and `|---|---|` separator. Keep cells short; no line breaks in cells.
- Blockquote `> text` for notes. Horizontal rule `---`.
- Placeholders in guillemets: «اسم المنشأة», «رقم السجل التجاري», «التاريخ», «اسم المدير» … (they get highlighted).

## Each policy/charter should normally include
Document control table (الإصدار، تاريخ الاعتماد، جهة الاعتماد، مالك السياسة، تاريخ المراجعة القادمة)،
الغرض، النطاق، التعريفات، المبادئ/الأحكام التفصيلية، الأدوار والمسؤوليات (table or list)،
الإجراءات خطوة بخطوة مع مدد زمنية واضحة، النماذج/الملاحق المرتبطة (e.g. an embedded form or checklist),
المخالفات والجزاءات، المراجعة والتحديث، الاعتماد (signature block table).
Forms/resolutions: complete fillable text, recitals (بعد الاطلاع على...), numbered resolutions, signature tables.
Target length per document: roughly 4,000–9,000 Arabic characters (charters/regulations may be longer). Quality over padding.

## Accuracy rules (important)
- Saudi legal context: نظام الشركات (م/132 وتاريخ 1443/12/1هـ) ولوائحه التنفيذية، لائحة حوكمة الشركات (هيئة السوق المالية)
  للمدرجة، نظام حماية البيانات الشخصية (م/19 وتاريخ 1443/2/9هـ وتعديلاته) ولائحته التنفيذية ولائحة نقل البيانات خارج المملكة (سدايا)،
  نظام العمل ولائحته التنفيذية، نظام مكافحة غسل الأموال، نظام مكافحة الرشوة، نظام ضريبة القيمة المضافة ولائحة الفوترة الإلكترونية (هيئة الزكاة والضريبة والجمارك)،
  ضوابط الهيئة الوطنية للأمن السيبراني (ECC) حيث يناسب.
- Cite laws by name. Only cite a specific article number or a specific numeric deadline if you are confident it is correct
  (well-known ones: PDPL breach notification to SDAIA within 72 hours; responding to data-subject requests within 30 days;
  E-invoicing record retention; work regulation must be approved by HRSD). If unsure, phrase as «وفق المدد المحددة في اللائحة التنفيذية».
- Use neutral, formal Modern Standard Arabic, consistent terminology: «المنشأة»، «مجلس الإدارة»، «المدير»، «الشركاء»، «الجمعية العامة»، «مسؤول حماية البيانات الشخصية».
- Where a rule differs by entity type (LLC vs JSC vs listed), say so explicitly inside the document.
