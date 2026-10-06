#!/usr/bin/env python3
"""فحص شامل بعد النشر عبر الواجهة البرمجية الحقيقية (يُستخدم في CI ويمكن تشغيله على الخادم):
تغيير كلمة المرور المؤقتة ← إنشاء منشأة ← تسجيل دفعة ← فاتورة ضريبية ← إشعار دائن ← مصروف ← الملخص المالي.

    python3 deploy/scripts/smoke.py --base https://admin.localhost/api --email ci@haseef.sa --password <مؤقتة> [--insecure]
"""

from __future__ import annotations

import argparse
import json
import secrets
import ssl
import sys
import urllib.error
import urllib.request

ap = argparse.ArgumentParser()
ap.add_argument("--base", required=True)
ap.add_argument("--email", required=True)
ap.add_argument("--password", required=True)
ap.add_argument("--resolve", help="host:ip لتوجيه النطاق محلياً (CI)")
ap.add_argument("--insecure", action="store_true", help="شهادة محلية غير موثوقة (CI فقط)")
args = ap.parse_args()
ctx = ssl._create_unverified_context() if args.insecure else None
token: str | None = None


def call(method: str, path: str, body: dict | None = None, expect: int = 200, org_id: str | None = None):
    req = urllib.request.Request(args.base + path, method=method, data=json.dumps(body).encode() if body is not None else None,
                                 headers={"Content-Type": "application/json", **({"Authorization": f"Bearer {token}"} if token else {}),
                                          **({"X-Org-Id": org_id} if org_id else {})})
    try:
        with urllib.request.urlopen(req, context=ctx, timeout=20) as r:
            code, raw = r.status, r.read()
    except urllib.error.HTTPError as e:
        code, raw = e.code, e.read()
    if code != expect:
        print(f"::error::{method} {path} → {code}: {raw[:400].decode(errors='replace')}")
        sys.exit(1)
    return json.loads(raw) if raw else None


def step(name: str):
    print(f"✓ {name}")


token = call("POST", "/v1/auth/login", {"email": args.email, "password": args.password})["access_token"]
new_pw = secrets.token_urlsafe(16)
call("POST", "/v1/auth/change-password", {"current_password": args.password, "new_password": new_pw}, expect=204)
token = call("POST", "/v1/auth/login", {"email": args.email, "password": new_pw})["access_token"]
step("تغيير كلمة المرور المؤقتة")

call("PUT", "/v1/admin/finance/profile", {"legal_name": "حصيف لتقنية المعلومات", "trade_name": "حصيف", "vat_registered": True,
                                          "vat_number": "300000000000003", "cr_number": "1010000000"})
cr = "70" + str(secrets.randbelow(10**8)).zfill(8)
org = call("POST", "/v1/admin/organizations", {"name": "منشأة فحص النشر", "cr_number": cr, "entity_legal_type": "LLC",
                                                "plan_tier": "ESSENTIAL", "admin_email": f"owner{cr}@example.com",
                                                "admin_full_name": "مالك تجريبي"}, expect=201)
pay = call("POST", f"/v1/admin/organizations/{org['id']}/subscription/payment",
           {"amount_sar": 199, "billing_cycle": "MONTHLY", "reference": "SMOKE-1"})
inv = call("GET", f"/v1/admin/finance/invoices/{pay['invoice']['id']}")
assert inv["total"] == 228.85 and inv["vat_amount"] == 29.85 and inv["qr"], inv
step(f"فاتورة ضريبية تلقائية {inv['number']} بإجمالي {inv['total']}")

cn = call("POST", f"/v1/admin/finance/invoices/{inv['id']}/void", {"reason": "فحص الإشعار الدائن"})
call("POST", f"/v1/admin/finance/invoices/{inv['id']}/void", {"reason": "مرة ثانية"}, expect=409)
step(f"إشعار دائن {cn['credit_note']['number']} ومنع الإلغاء المكرر")

call("POST", "/v1/admin/finance/expenses", {"spent_on": inv["issued_at"][:10], "category": "HOSTING", "vendor": "مزوّد الاستضافة",
                                             "net_amount": 300, "vat_amount": 45}, expect=201)
period = inv["issued_at"][:7]
s = call("GET", f"/v1/admin/finance/summary?period={period}")
assert s["revenue"]["total"] == 0 and s["expenses"]["total"] == 300 and s["vat"]["payable"] == -45, s
q = (int(period[5:7]) - 1) // 3 + 1
v = call("GET", f"/v1/admin/finance/vat?period={period[:4]}-Q{q}")
assert v["payable"] == -45, v
st = call("GET", f"/v1/admin/finance/statement?view=monthly&year={period[:4]}")
assert len(st["columns"]) == 12 and st["expenses_total"]["total"] == 300, st
st = call("GET", f"/v1/admin/finance/statement?view=yearly&year={period[:4]}&years=3")
assert len(st["columns"]) == 3, st
step("المصروفات والملخص المالي وإقرار الضريبة")
plan = call("POST", "/v1/admin/finance/plans", {"org_id": org["id"], "plan_tier": "PROFESSIONAL_GRC", "installments": 4,
                                               "starts_on": inv["issued_at"][:10], "pay_first": True, "first_reference": "SMOKE-Q1"}, expect=201)
d = call("GET", f"/v1/admin/finance/plans/{plan['id']}")
assert d["paid_net"] == 1247.5 and d["remaining_net"] == 3742.5 and len(d["items"]) == 4, d
second = d["items"][1]["id"]
call("POST", f"/v1/admin/finance/plans/{plan['id']}/installments/{second}/remind", {})
r = call("POST", f"/v1/admin/finance/plans/{plan['id']}/installments/{second}/pay", {"reference": "SMOKE-Q2"})
call("POST", f"/v1/admin/finance/plans/{plan['id']}/installments/{second}/pay", {"reference": "again"}, expect=409)
d = call("GET", f"/v1/admin/finance/plans/{plan['id']}")
assert d["paid_count"] == 2 and d["remaining_net"] == 2495.0, d
call("POST", "/v1/admin/finance/plans", {"org_id": org["id"], "plan_tier": "ESSENTIAL", "installments": 2,
                                          "starts_on": inv["issued_at"][:10]}, expect=409)
step(f"اشتراك سنوي بأربعة أقساط: مدفوع قسطان، المتبقي {d['remaining_net']}، وتذكير يدوي، وفاتورة {r['invoice']['number']}")
call("POST", "/v1/admin/finance/expenses", {"spent_on": inv["issued_at"][:10], "category": "GOSI", "vendor": "المؤسسة العامة للتأمينات الاجتماعية",
                                             "net_amount": 2150, "vat_amount": 0, "frequency": "MONTHLY"}, expect=201)
step("مصروف التأمينات الاجتماعية لحصيف نفسها")

# العمل والموظفين بحساب العميل: التقويم الشهري لكل الباقات، وسجل الموظفين لباقة الحوكمة فأعلى
token = call("POST", "/v1/auth/login", {"email": f"owner{cr}@example.com", "password": org["temporary_password"]})["access_token"]
owner_pw = secrets.token_urlsafe(16)
call("POST", "/v1/auth/change-password", {"current_password": org["temporary_password"], "new_password": owner_pw}, expect=204)
token = call("POST", "/v1/auth/login", {"email": f"owner{cr}@example.com", "password": owner_pw})["access_token"]
o = org["id"]
lo = call("GET", "/v1/labor/overview", org_id=o)
assert lo["enabled"] is False and lo["tasks"] == [], lo
call("PUT", "/v1/labor/profile", {"salary_day": 25}, org_id=o)
lo = call("GET", "/v1/labor/overview", org_id=o)
assert lo["enabled"] and len(lo["tasks"]) == 6, lo
gosi = next(t for t in lo["tasks"] if t["kind"] == "GOSI_PAYMENT")
call("POST", f"/v1/labor/tasks/{gosi['id']}/done", {"reference": "SADAD-1"}, org_id=o)
call("POST", f"/v1/labor/tasks/{gosi['id']}/done", {"reference": "again"}, expect=409, org_id=o)
call("POST", "/v1/labor/employees", {"full_name": "موظف فحص", "nationality": "SAUDI", "start_date": "2025-01-01", "gosi_system": "OLD",
                                     "basic_wage": 8000, "housing_allowance": 2000, "gosi_registered": True}, expect=201, org_id=o)
g = call("GET", "/v1/labor/gosi", org_id=o)
assert g["total"] == 2150 and len(g["lines"]) == 1, g
c = call("POST", "/v1/labor/calculator", {"nationality": "NON_SAUDI", "basic_wage": 3000, "housing_allowance": 750}, org_id=o)
assert c["employer"] == 75 and c["employee"] == 0, c
lo = call("GET", "/v1/labor/overview", org_id=o)
assert lo["hr"] and lo["indicators"]["employees"] == 1, lo
step("سجل الموظفين وحاسبة التأمينات في باقة الأساس")
al = call("GET", "/v1/alerts/overview", org_id=o)
assert "LABOR_TASK" in al["rules"], al["rules"]
step(f"تقويم العمل: {len(lo['tasks'])} مهام شهرية، وتأكيد سداد التأمينات، وقواعد التنبيه")
print("اكتمل الفحص المالي والعمالي")
