"""نصوص المكتبة الكاملة الجاهزة للتبنّي: سياسات ولوائح ونماذج وهياكل حسب نوع المنشأة.

كل ملف يعرّف DOCS. تُدمج في TEMPLATES بالمعرّف (slug): المعرّف الموجود يُستبدل بالنص الكامل، والجديد يُضاف.
"""

from __future__ import annotations

from . import gov_charters, gov_forms, gov_policies, gov_structures, ops_policies, pdpl_forms, pdpl_policies

ALL_DOCS: list[dict] = [
    *gov_structures.DOCS, *gov_charters.DOCS, *gov_policies.DOCS, *gov_forms.DOCS,
    *pdpl_policies.DOCS, *pdpl_forms.DOCS, *ops_policies.DOCS,
]
