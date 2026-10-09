"""الحضور بالموقع وبصمة الجوال.

الموارد البشرية: المواقع بنصف قطرها، أوقات الدوام، روابط الموظفين الشخصية، إلغاء ربط الأجهزة، والتقارير.
الموظف (صفحة عامة برابطه الشخصي، دون حساب في حصيف): يربط جواله ببصمته مرة، ثم يسجّل الحضور والانصراف
بموقعه الحالي وبصمته. الخادم يتحقق من التوقيع (WebAuthn) ومن المسافة ودقة القراءة قبل القبول.

الخصوصية: يُؤخذ الموقع لحظة التسجيل فقط، ويُحذف الإحداثي بعد مدة الاحتفاظ ويبقى السجل، ويُضاف النشاط لسجل المعالجة.
"""

from __future__ import annotations

import hashlib
import json
import secrets
from datetime import date, datetime, time, timedelta
from decimal import Decimal
from typing import Literal
from urllib.parse import urlparse
from uuid import UUID
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import Connection, text

from ..config import get_settings
from ..db import platform_tx
from ..deps import Tenant, get_tenant
from ..domain.attendance import FLAG_LABEL, REASON_LABEL, evaluate
from ..domain.webauthn import WebAuthnError, verify_assertion, verify_registration
from ..services import pricing
from .compliance import _audit

router = APIRouter(tags=["attendance"])
RIYADH = ZoneInfo("Asia/Riyadh")
MANAGERS = ("ORG_ADMIN", "COMPLIANCE_OFFICER")
ADDON = "ATTENDANCE"


def _f(v):
    if isinstance(v, Decimal):
        return float(v)
    if isinstance(v, (datetime, date, time)):
        return v.isoformat()
    return v


def _row(r) -> dict:
    return {k: _f(v) for k, v in dict(r).items()}


def _hash(t: str) -> str:
    return hashlib.sha256(t.encode()).hexdigest()


def _rp() -> tuple[str, str]:
    u = urlparse(get_settings().client_base_url)
    return f"{u.scheme}://{u.netloc}", u.hostname or "localhost"


def _settings(c: Connection, org_id) -> dict:
    row = c.execute(text("SELECT * FROM attendance_settings WHERE org_id = :o"), {"o": org_id}).mappings().one_or_none()
    if row is None:
        c.execute(text("INSERT INTO attendance_settings (org_id) VALUES (:o) ON CONFLICT DO NOTHING"), {"o": org_id})
        # نشاط معالجة جديد لبيانات الموظفين: يُوثَّق في سجل المعالجة (نظام حماية البيانات الشخصية)
        if not c.execute(text("SELECT 1 FROM pdpl_data_records WHERE org_id = :o AND activity_name = 'تسجيل الحضور بالموقع'"), {"o": org_id}).first():
            c.execute(text("""INSERT INTO pdpl_data_records (org_id, activity_name, purpose, data_subjects, data_categories, legal_basis,
                                  retention_period_months, storage_location, processors, security_controls)
                              VALUES (:o, 'تسجيل الحضور بالموقع', 'إثبات الحضور والانصراف في مقر العمل وحساب التأخير',
                                  'EMPLOYEES', CAST(:cat AS jsonb), 'CONTRACTUAL', 3, 'SAUDI_LOCAL_CLOUD', '["حصيف"]',
                                  'الموقع لحظة التسجيل فقط، ويُحذف الإحداثي بعد مدة الاحتفاظ؛ بصمة الجهاز لا تغادر جوال الموظف')"""),
                      {"o": org_id, "cat": json.dumps(["الاسم", "الموقع الجغرافي لحظة التسجيل", "وقت الحضور والانصراف", "معرّف الجهاز"], ensure_ascii=False)})
        row = c.execute(text("SELECT * FROM attendance_settings WHERE org_id = :o"), {"o": org_id}).mappings().one()
    return dict(row)


def _need(t: Tenant, manage: bool = True) -> dict:
    a = pricing.addon_access(t.conn, t.org_id, ADDON)
    if not a["via"]:
        raise HTTPException(status.HTTP_402_PAYMENT_REQUIRED, "خدمة الحضور غير مفعّلة. اشترك فيها من «الاشتراك والدفعات».")
    if manage:
        t.require(*MANAGERS)
    return a


def _local(dt: datetime) -> datetime:
    return dt.astimezone(RIYADH)


# ================================================================ الموارد البشرية
@router.get("/attendance/overview")
def overview(t: Tenant = Depends(get_tenant)):
    c = t.conn
    a = pricing.addon_access(c, t.org_id, ADDON)
    out = {"access": {k: _f(v) for k, v in a.items()}, "can_manage": t.role in MANAGERS}
    if not a["via"]:
        return out
    s = _settings(c, t.org_id)
    sites = [_row(r) for r in c.execute(text("SELECT id, name, lat, lng, radius_m, max_accuracy_m, is_active FROM attendance_sites ORDER BY created_at")).mappings()]
    day_start = datetime.combine(datetime.now(RIYADH).date(), time(0), RIYADH)
    people = [_row(r) for r in c.execute(text("""
        SELECT e.id AS employee_id, e.full_name, e.job_title, (p.employee_id IS NOT NULL) AS has_link,
               d.created_at AS device_since, d.label AS device_label, d.last_used_at,
               (SELECT min(at) FROM attendance_records r WHERE r.employee_id = e.id AND r.kind = 'IN' AND r.status = 'ACCEPTED' AND r.at >= :d) AS in_at,
               (SELECT max(at) FROM attendance_records r WHERE r.employee_id = e.id AND r.kind = 'OUT' AND r.status = 'ACCEPTED' AND r.at >= :d) AS out_at,
               (SELECT max(late_minutes) FROM attendance_records r WHERE r.employee_id = e.id AND r.kind = 'IN' AND r.status = 'ACCEPTED' AND r.at >= :d) AS late_minutes
        FROM org_employees e
        LEFT JOIN attendance_people p ON p.employee_id = e.id
        LEFT JOIN attendance_devices d ON d.employee_id = e.id AND d.revoked_at IS NULL
        WHERE e.is_active ORDER BY e.full_name"""), {"d": day_start}).mappings()]
    recent = [_row(r) for r in c.execute(text("""
        SELECT r.id, r.kind, r.at, r.status, r.reason, r.distance_m, r.accuracy_m, r.late_minutes, r.flags, e.full_name, s.name AS site_name
        FROM attendance_records r JOIN org_employees e ON e.id = r.employee_id LEFT JOIN attendance_sites s ON s.id = r.site_id
        ORDER BY r.at DESC LIMIT 100""")).mappings()]
    for r in recent:
        r["reason_label"] = REASON_LABEL.get(r["reason"] or "", None)
        r["flag_labels"] = [FLAG_LABEL.get(f, f) for f in r["flags"]]
    return {**out, "settings": {k: _f(v) for k, v in s.items() if k != "org_id"}, "sites": sites, "people": people, "recent": recent,
            "limit": (a.get("limits") or {}).get("members"), "linked": sum(1 for p in people if p["has_link"])}


class SettingsIn(BaseModel):
    work_start: time = time(8)
    work_end: time = time(17)
    grace_minutes: int = Field(15, ge=0, le=180)
    work_days: list[int] = Field(default_factory=lambda: [0, 1, 2, 3, 4])
    require_device: bool = True
    retention_days: int = Field(90, ge=7, le=730)


@router.put("/attendance/settings")
def save_settings(body: SettingsIn, t: Tenant = Depends(get_tenant)):
    _need(t)
    if any(d not in range(7) for d in body.work_days):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "أيام العمل من 0 (الأحد) إلى 6 (السبت)")
    _settings(t.conn, t.org_id)
    t.conn.execute(text("""UPDATE attendance_settings SET work_start = :work_start, work_end = :work_end, grace_minutes = :grace_minutes,
                           work_days = :work_days, require_device = :require_device, retention_days = :retention_days, updated_at = now()"""),
                   {**body.model_dump(), "work_days": sorted(set(body.work_days))})
    _audit(t.conn, t, "UPDATE", "attendance_settings", None, body.model_dump(mode="json"))
    return {"ok": True}


class SiteIn(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)
    radius_m: int = Field(100, ge=20, le=2000)
    max_accuracy_m: int = Field(100, ge=10, le=1000)
    is_active: bool = True


@router.post("/attendance/sites", status_code=201)
def add_site(body: SiteIn, t: Tenant = Depends(get_tenant)):
    _need(t)
    sid = t.conn.execute(text("""INSERT INTO attendance_sites (org_id, name, lat, lng, radius_m, max_accuracy_m, is_active)
                                 VALUES (:o, :name, :lat, :lng, :radius_m, :max_accuracy_m, :is_active) RETURNING id"""),
                         {**body.model_dump(), "o": t.org_id}).scalar_one()
    _audit(t.conn, t, "CREATE", "attendance_site", sid, body.model_dump())
    return {"id": sid}


@router.put("/attendance/sites/{site_id}")
def edit_site(site_id: UUID, body: SiteIn, t: Tenant = Depends(get_tenant)):
    _need(t)
    if not t.conn.execute(text("""UPDATE attendance_sites SET name = :name, lat = :lat, lng = :lng, radius_m = :radius_m,
                                  max_accuracy_m = :max_accuracy_m, is_active = :is_active WHERE id = :id"""),
                          {**body.model_dump(), "id": site_id}).rowcount:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "الموقع غير موجود")
    _audit(t.conn, t, "UPDATE", "attendance_site", site_id, body.model_dump())
    return {"ok": True}


@router.delete("/attendance/sites/{site_id}", status_code=204)
def delete_site(site_id: UUID, t: Tenant = Depends(get_tenant)):
    _need(t)
    t.conn.execute(text("UPDATE attendance_sites SET is_active = false WHERE id = :id"), {"id": site_id})
    _audit(t.conn, t, "DEACTIVATE", "attendance_site", site_id)


def issue_link(c: Connection, org_id, employee_id) -> str:
    """رابط شخصي جديد (يُبطل السابق). الرابط وحده لا يكفي: التسجيل يتطلب بصمة الجهاز المربوط."""
    token = secrets.token_urlsafe(24)
    c.execute(text("""INSERT INTO attendance_people (employee_id, org_id, token_hash) VALUES (:e, :o, :h)
                      ON CONFLICT (employee_id) DO UPDATE SET token_hash = EXCLUDED.token_hash, created_at = now()"""),
              {"e": employee_id, "o": org_id, "h": _hash(token)})
    return f"{get_settings().client_base_url}/attend/?t={token}"


@router.post("/attendance/people/{employee_id}/link")
def make_link(employee_id: UUID, t: Tenant = Depends(get_tenant)):
    a = _need(t)
    c = t.conn
    if not c.execute(text("SELECT 1 FROM org_employees WHERE id = :e AND is_active"), {"e": employee_id}).first():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "الموظف غير موجود")
    limit = (a.get("limits") or {}).get("members")
    if limit is not None and not c.execute(text("SELECT 1 FROM attendance_people WHERE employee_id = :e"), {"e": employee_id}).first():
        if c.execute(text("SELECT count(*) FROM attendance_people")).scalar_one() >= limit:
            raise HTTPException(status.HTTP_409_CONFLICT, f"بلغت الحد ({limit} موظفاً) في اشتراك الحضور")
    url = issue_link(c, t.org_id, employee_id)
    _audit(c, t, "LINK", "attendance_person", employee_id)
    return {"url": url}


@router.delete("/attendance/people/{employee_id}/device", status_code=204)
def revoke_device(employee_id: UUID, t: Tenant = Depends(get_tenant)):
    _need(t)
    t.conn.execute(text("UPDATE attendance_devices SET revoked_at = now() WHERE employee_id = :e AND revoked_at IS NULL"), {"e": employee_id})
    _audit(t.conn, t, "REVOKE", "attendance_device", employee_id)


@router.get("/attendance/report")
def report(month: str, t: Tenant = Depends(get_tenant)):
    _need(t, manage=False)
    try:
        start = date.fromisoformat(f"{month}-01")
    except ValueError:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "صيغة الشهر YYYY-MM")
    end = date(start.year + (start.month == 12), start.month % 12 + 1, 1)
    s = _settings(t.conn, t.org_id)
    today = datetime.now(RIYADH).date()
    from ..services.hr_service import work_calendar
    _, holidays, _ = work_calendar(t.conn, t.org_id)
    workdays = [start + timedelta(days=i) for i in range((min(end, today + timedelta(days=1)) - start).days)
                if ((start + timedelta(days=i)).weekday() + 1) % 7 in s["work_days"] and start + timedelta(days=i) not in holidays]
    leaves: dict = {}
    for lv in t.conn.execute(text("""SELECT employee_id, start_date, end_date FROM leave_requests WHERE status = 'APPROVED'
                                     AND start_date < :e AND end_date >= :s"""), {"s": start, "e": end}).mappings():
        leaves.setdefault(lv["employee_id"], set()).update(d for d in workdays if lv["start_date"] <= d <= lv["end_date"])
    rows = t.conn.execute(text("""
        SELECT e.id, e.full_name,
               count(DISTINCT (r.at AT TIME ZONE 'Asia/Riyadh')::date) FILTER (WHERE r.kind = 'IN' AND r.status = 'ACCEPTED') AS days_present,
               count(*) FILTER (WHERE r.kind = 'IN' AND r.status = 'ACCEPTED' AND r.late_minutes > 0) AS late_days,
               COALESCE(sum(r.late_minutes) FILTER (WHERE r.kind = 'IN' AND r.status = 'ACCEPTED'), 0) AS late_minutes,
               count(*) FILTER (WHERE r.status = 'REJECTED') AS rejected,
               count(*) FILTER (WHERE r.status = 'ACCEPTED' AND cardinality(r.flags) > 0) AS flagged
        FROM org_employees e
        LEFT JOIN attendance_records r ON r.employee_id = e.id AND r.at >= :s AND r.at < :e
        WHERE e.is_active GROUP BY e.id, e.full_name ORDER BY e.full_name"""),
        {"s": datetime.combine(start, time(0), RIYADH), "e": datetime.combine(end, time(0), RIYADH)}).mappings()
    return {"month": month, "workdays": len(workdays),
            "rows": [{**_row(r), "leave_days": len(leaves.get(r["id"], ())),
                      "absent_days": max(len(workdays) - r["days_present"] - len(leaves.get(r["id"], ())), 0)} for r in rows]}


# ================================================================ صفحة الموظف (عامة برابطه الشخصي)
def _person(c: Connection, token: str) -> dict:
    if len(token) > 64:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "الرابط غير صالح")
    p = c.execute(text("""SELECT p.employee_id, p.org_id, e.full_name, o.name AS org_name FROM attendance_people p
                          JOIN org_employees e ON e.id = p.employee_id AND e.is_active JOIN organizations o ON o.id = p.org_id AND o.is_active
                          WHERE p.token_hash = :h"""), {"h": _hash(token)}).mappings().one_or_none()
    if p is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "الرابط غير صالح أو أُلغي. اطلب رابطاً جديداً من الموارد البشرية أو من مساعد واتساب.")
    if not pricing.addon_access(c, p["org_id"], ADDON)["via"]:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "خدمة الحضور غير مفعّلة لمنشأتك حالياً.")
    return dict(p)


def _challenge(c: Connection, p: dict, purpose: str) -> str:
    ch = secrets.token_urlsafe(32)
    c.execute(text("""INSERT INTO attendance_challenges (challenge, org_id, employee_id, purpose, expires_at)
                      VALUES (:c, :o, :e, :p, now() + interval '5 minutes')"""),
              {"c": ch, "o": p["org_id"], "e": p["employee_id"], "p": purpose})
    return ch


def _use_challenge(c: Connection, p: dict, ch: str, purpose: str) -> None:
    n = c.execute(text("""UPDATE attendance_challenges SET used_at = now() WHERE challenge = :c AND employee_id = :e AND purpose = :p
                          AND used_at IS NULL AND expires_at > now()"""), {"c": ch, "e": p["employee_id"], "p": purpose}).rowcount
    if not n:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "انتهت صلاحية الطلب. أعد المحاولة.")


@router.get("/public/attendance/{token}")
def person_page(token: str):
    origin, rp_id = _rp()
    with platform_tx() as c:
        p = _person(c, token)
        s = _settings(c, p["org_id"])
        dev = c.execute(text("SELECT credential_id FROM attendance_devices WHERE employee_id = :e AND revoked_at IS NULL"),
                        {"e": p["employee_id"]}).scalar_one_or_none()
        day_start = datetime.combine(datetime.now(RIYADH).date(), time(0), RIYADH)
        today = [_row(r) for r in c.execute(text("""SELECT kind, at, status, reason, late_minutes FROM attendance_records
                                                    WHERE employee_id = :e AND at >= :d ORDER BY at"""),
                                            {"e": p["employee_id"], "d": day_start}).mappings()]
        for r in today:
            r["reason_label"] = REASON_LABEL.get(r["reason"] or "", None)
        sites = [r[0] for r in c.execute(text("SELECT name FROM attendance_sites WHERE org_id = :o AND is_active"), {"o": p["org_id"]})]
        purpose = "CHECK" if dev else "ENROLL"
        ch = _challenge(c, p, purpose)
    return {"employee_name": p["full_name"], "org_name": p["org_name"], "has_device": dev is not None,
            "require_device": s["require_device"], "sites": sites, "today": today,
            "webauthn": {"rp_id": rp_id, "rp_name": "حصيف", "challenge": ch, "purpose": purpose,
                         "user_id": str(p["employee_id"]), "credential_id": dev}}


class EnrollIn(BaseModel):
    challenge: str = Field(max_length=64)
    client_data_json: str = Field(max_length=4000)
    attestation_object: str = Field(max_length=20000)
    label: str | None = Field(None, max_length=80)


@router.post("/public/attendance/{token}/enroll", status_code=201)
def enroll(token: str, body: EnrollIn):
    origin, rp_id = _rp()
    with platform_tx() as c:
        p = _person(c, token)
        if c.execute(text("SELECT 1 FROM attendance_devices WHERE employee_id = :e AND revoked_at IS NULL"), {"e": p["employee_id"]}).first():
            raise HTTPException(status.HTTP_409_CONFLICT, "لديك جهاز مربوط. لتغييره اطلب من الموارد البشرية إلغاء الربط.")
        _use_challenge(c, p, body.challenge, "ENROLL")
        try:
            cred, cose, cnt = verify_registration(client_data_json=body.client_data_json, attestation_object=body.attestation_object,
                                                  challenge=body.challenge, origin=origin, rp_id=rp_id)
        except WebAuthnError as e:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e))
        c.execute(text("""INSERT INTO attendance_devices (org_id, employee_id, credential_id, public_key, sign_count, label)
                          VALUES (:o, :e, :c, :k, :n, :l)"""),
                  {"o": p["org_id"], "e": p["employee_id"], "c": cred, "k": cose, "n": cnt, "l": body.label})
        c.execute(text("""INSERT INTO audit_log (org_id, action, entity_type, entity_id) VALUES (:o, 'DEVICE_ENROLLED', 'attendance_device', :e)"""),
                  {"o": p["org_id"], "e": p["employee_id"]})
    return {"enrolled": True}


class CheckIn(BaseModel):
    kind: Literal["IN", "OUT"]
    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)
    accuracy: float = Field(ge=0, le=100000)
    challenge: str | None = Field(None, max_length=64)
    credential_id: str | None = Field(None, max_length=1000)
    client_data_json: str | None = Field(None, max_length=4000)
    authenticator_data: str | None = Field(None, max_length=4000)
    signature: str | None = Field(None, max_length=2000)


@router.post("/public/attendance/{token}/check")
def check(token: str, body: CheckIn):
    origin, rp_id = _rp()
    with platform_tx() as c:
        p = _person(c, token)
        s = _settings(c, p["org_id"])
        recent = c.execute(text("SELECT count(*) FROM attendance_records WHERE employee_id = :e AND at > now() - interval '1 hour'"),
                           {"e": p["employee_id"]}).scalar_one()
        if recent >= 30:
            raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "محاولات كثيرة. حاول بعد قليل.")
        dev = c.execute(text("SELECT id, credential_id, public_key, sign_count FROM attendance_devices WHERE employee_id = :e AND revoked_at IS NULL"),
                        {"e": p["employee_id"]}).mappings().one_or_none()
        device_id, reject = None, None
        if s["require_device"] or dev:
            if not dev:
                reject = "NO_DEVICE"
            elif not (body.challenge and body.client_data_json and body.authenticator_data and body.signature) or body.credential_id != dev["credential_id"]:
                reject = "BAD_DEVICE"
            else:
                _use_challenge(c, p, body.challenge, "CHECK")
                try:
                    cnt = verify_assertion(cose_key=bytes(dev["public_key"]), client_data_json=body.client_data_json,
                                           authenticator_data=body.authenticator_data, signature=body.signature,
                                           challenge=body.challenge, origin=origin, rp_id=rp_id, prev_sign_count=dev["sign_count"])
                    c.execute(text("UPDATE attendance_devices SET sign_count = :n, last_used_at = now() WHERE id = :d"), {"n": cnt, "d": dev["id"]})
                    device_id = dev["id"]
                except WebAuthnError:
                    reject = "BAD_DEVICE"
        now_local = datetime.now(RIYADH)
        if reject:
            res = {"status": "REJECTED", "reason": reject, "site_id": None, "distance_m": None, "flags": [], "late_minutes": None}
        else:
            sites = [dict(r) for r in c.execute(text("""SELECT id, lat, lng, radius_m, max_accuracy_m, is_active FROM attendance_sites
                                                        WHERE org_id = :o AND is_active"""), {"o": p["org_id"]}).mappings()]
            last = c.execute(text("""SELECT at, lat, lng FROM attendance_records WHERE employee_id = :e AND status = 'ACCEPTED'
                                     ORDER BY at DESC LIMIT 1"""), {"e": p["employee_id"]}).mappings().one_or_none()
            res = evaluate(lat=body.lat, lng=body.lng, accuracy=body.accuracy, sites=sites, kind=body.kind, now_local=now_local,
                           work_start=s["work_start"], grace_minutes=s["grace_minutes"], work_days=list(s["work_days"]),
                           last={"at": _local(last["at"]), "lat": last["lat"], "lng": last["lng"]} if last else None)
        c.execute(text("""INSERT INTO attendance_records (org_id, employee_id, kind, status, reason, site_id, distance_m, accuracy_m,
                                                          lat, lng, device_id, late_minutes, flags)
                          VALUES (:o, :e, :k, :s, :r, :site, :d, :acc, :lat, :lng, :dev, :late, :flags)"""),
                  {"o": p["org_id"], "e": p["employee_id"], "k": body.kind, "s": res["status"], "r": res["reason"], "site": res["site_id"],
                   "d": res["distance_m"], "acc": round(body.accuracy), "lat": round(body.lat, 6), "lng": round(body.lng, 6),
                   "dev": device_id, "late": res["late_minutes"], "flags": res["flags"]})
        site_name = c.execute(text("SELECT name FROM attendance_sites WHERE id = :s"), {"s": res["site_id"]}).scalar_one_or_none() if res["site_id"] else None
    return {"status": res["status"], "reason": res["reason"], "reason_label": REASON_LABEL.get(res["reason"] or "", None),
            "distance_m": res["distance_m"], "site_name": site_name, "late_minutes": res["late_minutes"],
            "at": now_local.isoformat(), "kind": body.kind}


def purge_coordinates(c: Connection) -> int:
    """يُحذف الإحداثي بعد مدة الاحتفاظ (الافتراضية 90 يوماً)، ويبقى السجل والمسافة."""
    return c.execute(text("""
        UPDATE attendance_records r SET lat = NULL, lng = NULL
        WHERE r.lat IS NOT NULL AND r.at < now() - make_interval(days => COALESCE(
            (SELECT s.retention_days FROM attendance_settings s WHERE s.org_id = r.org_id), 90))""")).rowcount
