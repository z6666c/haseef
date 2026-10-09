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


def call(method: str, path: str, body: dict | None = None, expect: int = 200, org_id: str | None = None, raw: bool = False):
    req = urllib.request.Request(args.base + path, method=method, data=json.dumps(body).encode() if body is not None else None,
                                 headers={"Content-Type": "application/json", **({"Authorization": f"Bearer {token}"} if token else {}),
                                          **({"X-Org-Id": org_id} if org_id else {})})
    try:
        with urllib.request.urlopen(req, context=ctx, timeout=20) as r:
            code, body_bytes = r.status, r.read()
    except urllib.error.HTTPError as e:
        code, body_bytes = e.code, e.read()
    if code != expect:
        print(f"::error::{method} {path} → {code}: {body_bytes[:400].decode(errors='replace')}")
        sys.exit(1)
    if raw:
        return body_bytes.decode()
    return json.loads(body_bytes) if body_bytes else None


def step(name: str):
    print(f"✓ {name}")


token = call("POST", "/v1/auth/login", {"email": args.email, "password": args.password})["access_token"]
new_pw = secrets.token_urlsafe(16)
call("POST", "/v1/auth/change-password", {"current_password": args.password, "new_password": new_pw}, expect=204)
token = call("POST", "/v1/auth/login", {"email": args.email, "password": new_pw})["access_token"]
admin_token = token
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
# التسجيل الذاتي ← معالج الإعداد ← الزكاة والضريبة ← التقويم ← الدفع ← البوت
token = None
scr = "71" + str(secrets.randbelow(10**8)).zfill(8)
su = call("POST", "/v1/public/signup", {"company_name": "منشأة تسجيل ذاتي", "cr_number": scr, "entity_legal_type": "LLC",
                                         "full_name": "مسجّل تجريبي", "email": f"self{scr}@example.com", "password": secrets.token_urlsafe(14),
                                         "plan_tier": "ESSENTIAL", "consent": True}, expect=201)
token, so = su["access_token"], su["org_id"]
call("POST", "/v1/public/signup", {"company_name": "مكرر", "cr_number": scr, "entity_legal_type": "LLC", "full_name": "سامي",
                                   "email": f"dup{scr}@example.com", "password": "x" * 12, "consent": True}, expect=409)
ob = call("GET", "/v1/onboarding", org_id=so)
assert ob["needs_onboarding"] and ob["billing_status"] == "TRIAL" and not ob["email_verified"], ob
call("POST", "/v1/onboarding", {"commercial_size": "SMALL", "industry_type": "تجزئة", "employees_count": 8, "labor_enabled": True, "salary_day": 25,
                                "vat_registered": True, "vat_frequency": "QUARTERLY", "withholding_applies": True, "fiscal_year_end_month": 12,
                                "alert_phone": None}, org_id=so)
assert not call("GET", "/v1/onboarding", org_id=so)["needs_onboarding"]
tx = call("GET", "/v1/tax/overview", org_id=so)
kinds = {t["kind"] for t in tx["tasks"]}
assert tx["enabled"] and kinds == {"VAT_RETURN", "WHT_RETURN", "ZAKAT_RETURN"}, tx
vat = next(t for t in tx["tasks"] if t["kind"] == "VAT_RETURN")
call("POST", f"/v1/tax/tasks/{vat['id']}/done", {"reference": "ZATCA-1"}, org_id=so)
step(f"تسجيل ذاتي بتجربة 14 يوماً، ومعالج الإعداد، و{len(tx['tasks'])} مهام زكاة وضريبة")
feed = call("POST", "/v1/calendar/feed", {"include_people": False}, expect=201, org_id=so)
ics = call("GET", "/v1/public/calendar/" + feed["url"].rsplit("/", 1)[1], raw=True)
assert ics.startswith("BEGIN:VCALENDAR") and "VEVENT" in ics, ics[:200]
call("GET", "/v1/public/calendar/not-a-real-token.ics", expect=404)
step("رابط تقويم ICS يعمل ويرفض الرموز غير الصحيحة")
call("POST", "/v1/billing/checkout", {"purpose": "SUBSCRIPTION", "plan_tier": "ESSENTIAL", "billing_cycle": "MONTHLY"}, expect=503, org_id=so)
assert call("GET", "/v1/bot/overview", org_id=so)["access"]["via"] is None
call("PUT", "/v1/bot/settings", {"enabled": True}, expect=402, org_id=so)
step("الدفع الإلكتروني متوقف بأمان دون مفتاح البوابة، والبوت مقفل لباقة الأساس")
# التسعير من غرفة العمليات: شمول البوت لباقة الأساس ثم إعادته
token = admin_token
pr = call("GET", "/v1/admin/pricing")
bot = next(a for a in pr["addons"] if a["code"] == "WA_BOT")
assert bot["monthly_price"] == 99 and bot["included_tiers"] == ["ENTERPRISE"], bot
call("PUT", "/v1/admin/pricing/addons/WA_BOT", {"monthly_price": 99, "included_tiers": ["ENTERPRISE", "ESSENTIAL"], "members": 50,
                                                 "questions": 1000, "included_unlimited": True, "is_active": True})
token = su["access_token"]
assert call("GET", "/v1/bot/overview", org_id=so)["access"]["via"] == "PLAN"
call("POST", "/v1/bot/faqs", {"question": "متى تصرف الرواتب؟", "answer": "يوم 27 من كل شهر."}, expect=201, org_id=so)
r = call("POST", "/v1/bot/simulate", {"text": "متى تصرف الرواتب"}, org_id=so)
assert r["intent"] == "ANSWER" and "27" in r["reply"], r
assert call("POST", "/v1/bot/simulate", {"text": "كم راتب زميلي؟"}, org_id=so)["intent"] == "SENSITIVE"
call("POST", "/v1/bot/members", {"full_name": "موظف تجريبي", "phone": "+9665" + str(secrets.randbelow(10**8)).zfill(8)}, expect=201, org_id=so)
# الحضور بالموقع: مقفل للأساس، ثم يُشمل مؤقتاً من التسعير
assert call("GET", "/v1/attendance/overview", org_id=so)["access"]["via"] is None
call("POST", "/v1/attendance/sites", {"name": "المقر", "lat": 24.7136, "lng": 46.6753}, expect=402, org_id=so)
token = admin_token
att = next(a for a in call("GET", "/v1/admin/pricing")["addons"] if a["code"] == "ATTENDANCE")
assert att["monthly_price"] == 49 and att["included_tiers"] == ["ENTERPRISE"], att
call("PUT", "/v1/admin/pricing/addons/ATTENDANCE", {"monthly_price": 49, "included_tiers": ["ENTERPRISE", "ESSENTIAL"], "members": 50,
                                                     "questions": None, "included_unlimited": True, "is_active": True})
token = su["access_token"]
ao = call("GET", "/v1/attendance/overview", org_id=so)
assert ao["access"]["via"] == "PLAN" and ao["settings"]["require_device"], ao
call("POST", "/v1/attendance/sites", {"name": "المقر الرئيسي", "lat": 24.7136, "lng": 46.6753, "radius_m": 100, "max_accuracy_m": 100,
                                       "is_active": True}, expect=201, org_id=so)
emp = call("POST", "/v1/labor/employees", {"full_name": "موظف حضور", "nationality": "SAUDI", "start_date": "2025-01-01", "gosi_system": "OLD",
                                           "basic_wage": 6000, "housing_allowance": 1500, "gosi_registered": True}, expect=201, org_id=so)["id"]
link = call("POST", f"/v1/attendance/people/{emp}/link", {}, org_id=so)["url"]
atok = link.split("t=", 1)[1]
token = None
pg = call("GET", f"/v1/public/attendance/{atok}")
assert pg["employee_name"] == "موظف حضور" and not pg["has_device"] and pg["webauthn"]["purpose"] == "ENROLL", pg
ck = call("POST", f"/v1/public/attendance/{atok}/check", {"kind": "IN", "lat": 24.7137, "lng": 46.6754, "accuracy": 15})
assert ck["status"] == "REJECTED" and ck["reason"] == "NO_DEVICE", ck
call("GET", "/v1/public/attendance/not-a-real-token", expect=404)
token = su["access_token"]
assert call("GET", "/v1/attendance/overview", org_id=so)["recent"][0]["reason"] == "NO_DEVICE"
assert any(r["full_name"] == "موظف حضور" for r in call("GET", "/v1/attendance/report?month=" + __import__("datetime").date.today().strftime("%Y-%m"), org_id=so)["rows"])
step("الحضور بالموقع: موقع ورابط شخصي، ويُرفض التسجيل دون جهاز مربوط ببصمة")
# الإجازات والمباشرة والخصومات (ضمن الإضافة نفسها)
import datetime as _dt
d0 = _dt.date.today()
ho = call("GET", "/v1/hr/overview", org_id=so)
assert {p["leave_type"] for p in ho["policies"]} == {"ANNUAL", "REGULAR", "EMERGENCY", "SICK"}, ho["policies"]
assert next(p for p in ho["people"] if p["id"] == emp)["entitlement"] == 21
lv = call("POST", "/v1/hr/leaves", {"employee_id": emp, "leave_type": "ANNUAL", "start_date": str(d0 + _dt.timedelta(days=20)),
                                     "end_date": str(d0 + _dt.timedelta(days=26)), "approve": True}, expect=201, org_id=so)
assert lv["status"] == "APPROVED" and lv["days"] == 5, lv
token = None
import base64 as _b64
_pdf = _b64.b64encode(b"%PDF-1.4\n% smoke medical report\n%%EOF").decode()
call("POST", f"/v1/public/attendance/{atok}/leaves", {"leave_type": "SICK", "start_date": str(d0), "end_date": str(d0), "medical_ref": "SL-1"}, expect=422)
call("POST", f"/v1/public/attendance/{atok}/leaves", {"leave_type": "SICK", "start_date": str(d0), "end_date": str(d0),
                                                     "attachment": {"file_name": "x.html", "file_base64": _b64.b64encode(b"<html><script>").decode()}}, expect=422)
sk = call("POST", f"/v1/public/attendance/{atok}/leaves", {"leave_type": "SICK", "start_date": str(d0), "end_date": str(d0), "medical_ref": "SL-1",
                                                          "attachment": {"file_name": "تقرير.pdf", "file_base64": _pdf}}, expect=201)
assert sk["status"] == "PENDING" and sk["has_attachment"] and "بأجر كامل" in sk["pay_note"], sk
token = su["access_token"]
assert call("GET", f"/v1/hr/leaves/{sk['id']}/attachment", org_id=so, raw=True).startswith("%PDF")
call("POST", f"/v1/hr/leaves/{sk['id']}/decide", {"approve": True}, org_id=so)
call("POST", "/v1/hr/deductions", {"employee_id": emp, "kind": "VIOLATION", "incident_date": str(d0), "description": "مخالفة فحص",
                                   "amount": 5000, "payroll_month": d0.strftime("%Y-%m")}, expect=422, org_id=so)
nt = call("POST", "/v1/hr/deductions", {"employee_id": emp, "kind": "VIOLATION", "incident_date": str(d0), "description": "مخالفة فحص",
                                        "amount": 100, "payroll_month": d0.strftime("%Y-%m")}, expect=201, org_id=so)
token = None
ph = call("GET", f"/v1/public/attendance/{atok}/hr")
assert ph["balance"]["used"] == 5 and len(ph["notices"]) == 1 and len(ph["leaves"]) == 2, ph
call("POST", f"/v1/public/attendance/{atok}/notices/{nt['id']}/object", {"objection": "كنت في مهمة رسمية خارج المقر"})
rg = call("POST", f"/v1/public/attendance/{atok}/leaves", {"leave_type": "REGULAR", "start_date": str(d0 + _dt.timedelta(days=40)),
                                                          "end_date": str(d0 + _dt.timedelta(days=41)), "is_paid": False}, expect=201)
assert rg["is_paid"] is False, rg
assert call("GET", f"/v1/public/attendance/{atok}/hr")["balance"]["used"] == 5, "unpaid leave must not touch the balance"
token = su["access_token"]
dd = call("GET", "/v1/hr/deductions?month=" + d0.strftime("%Y-%m"), org_id=so)
assert dd["notices"][0]["status"] == "OBJECTED", dd["notices"]
call("POST", f"/v1/hr/deductions/{nt['id']}/decide", {"confirm": False, "note": "قُبل الاعتراض"}, org_id=so)
call("PUT", "/v1/hr/policies/ANNUAL", {"pay_mode": "UNPAID", "from_balance": True, "min_notice_days": 0}, expect=422, org_id=so)
call("PUT", "/v1/hr/policies/EMERGENCY", {"pay_mode": "CHOICE", "from_balance": True, "max_days_per_request": 3, "yearly_cap": 5, "min_notice_days": 0}, org_id=so)
step("الإجازات الأربع والمرضية بشرائح الأجر، وسقف الغرامة، واعتراض الموظف على الخصم")
ev = call("GET", "/v1/events", org_id=so)
assert any(e["code"] == "NATIONAL_DAY" for e in ev["events"]) and not ev["settings"]["enabled"], ev
call("PUT", "/v1/events/settings", {"enabled": True, "signature": "إدارة منشأة الفحص", "excluded_codes": ["FLAG_DAY"]}, org_id=so)
assert call("GET", "/v1/events", org_id=so)["settings"]["enabled"]
token = admin_token
assert call("GET", "/v1/admin/events")["orgs_enabled"] >= 1
step("تقويم المناسبات وتفعيل تهنئة الموظفين")
token = admin_token
call("PUT", "/v1/admin/pricing/addons/WA_BOT", {"monthly_price": 99, "included_tiers": ["ENTERPRISE"], "members": 50,
                                                 "questions": 1000, "included_unlimited": True, "is_active": True})
call("PUT", "/v1/admin/pricing/addons/ATTENDANCE", {"monthly_price": 49, "included_tiers": ["ENTERPRISE"], "members": 50,
                                                     "questions": None, "included_unlimited": True, "is_active": True})
pub = {a["code"]: a for a in call("GET", "/v1/public/pricing")["addons"]}
assert pub["WA_BOT"]["monthly_price"] == 99 and pub["ATTENDANCE"]["monthly_price"] == 49, pub
step("التسعير من غرفة العمليات، وبوت الموظفين يجيب من الأسئلة الشائعة ويرفض الأسئلة الحساسة")
print("اكتمل الفحص المالي والعمالي والتسجيل والبوت والحضور")
