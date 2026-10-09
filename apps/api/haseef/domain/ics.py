"""تقويم iCalendar (RFC 5545) لمواعيد المنشأة: حدث طوال اليوم لكل موعد، مع تذكير قبل يوم. مطابق لـ shared/ics.ts."""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

TYPE_LABEL = {
    "COMPLIANCE_ITEM": "ترخيص أو وثيقة", "POLICY": "مراجعة سياسة", "IQAMA": "إقامة موظف", "WORK_PERMIT": "رخصة عمل",
    "CONTRACT_END": "عقد عمل", "PROBATION_END": "فترة تجربة", "LABOR_TASK": "التأمينات والأجور", "TAX_TASK": "الزكاة والضريبة",
}
PEOPLE_TYPES = {"IQAMA", "WORK_PERMIT", "CONTRACT_END", "PROBATION_END"}


def _esc(s: str) -> str:
    return s.replace("\\", "\\\\").replace(";", "\\;").replace(",", "\\,").replace("\n", "\\n")


def _fold(line: str) -> str:
    """الأسطر أطول من 75 بايت تُطوى (RFC 5545 §3.1)."""
    out, cur = [], b""
    for ch in line:
        b = ch.encode()
        if len(cur) + len(b) > 74:
            out.append(cur.decode())
            cur = b" " + b
        else:
            cur += b
    out.append(cur.decode())
    return "\r\n".join(out)


def event_title(target_type: str, title: str, include_people: bool) -> str:
    if target_type in PEOPLE_TYPES and not include_people:
        return title.split(" — ")[0] + " — موظف"
    return title


def build(org_name: str, events: list[dict], *, include_people: bool = False, now: datetime | None = None) -> str:
    stamp = (now or datetime.now(timezone.utc)).strftime("%Y%m%dT%H%M%SZ")
    lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Haseef//Compliance Calendar//AR", "CALSCALE:GREGORIAN",
             "METHOD:PUBLISH", f"X-WR-CALNAME:{_esc('حصيف — ' + org_name)}", "X-WR-TIMEZONE:Asia/Riyadh"]
    for e in sorted(events, key=lambda x: (x["due_date"], x["target_type"], str(x["target_id"]))):
        d: date = e["due_date"]
        title = event_title(e["target_type"], e["title"], include_people)
        desc = f"{TYPE_LABEL.get(e['target_type'], '')} — من منصة حصيف"
        lines += ["BEGIN:VEVENT", f"UID:{e['target_type']}-{e['target_id']}-{d:%Y%m%d}@haseef.sa", f"DTSTAMP:{stamp}",
                  f"DTSTART;VALUE=DATE:{d:%Y%m%d}", f"DTEND;VALUE=DATE:{d + timedelta(days=1):%Y%m%d}",
                  f"SUMMARY:{_esc(title)}", f"DESCRIPTION:{_esc(desc)}"]
        if e.get("link"):
            lines.append(f"URL:{e['link']}")
        lines += ["BEGIN:VALARM", "ACTION:DISPLAY", f"DESCRIPTION:{_esc(title)}", "TRIGGER:-P1D", "END:VALARM", "END:VEVENT"]
    lines.append("END:VCALENDAR")
    return "\r\n".join(_fold(l) for l in lines) + "\r\n"
