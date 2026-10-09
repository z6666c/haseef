/** iCalendar لمواعيد المنشأة — مطابق لـ apps/api/haseef/domain/ics.py. */
export const ICS_TYPE_LABEL: Record<string, string> = {
  COMPLIANCE_ITEM: "ترخيص أو وثيقة", POLICY: "مراجعة سياسة", IQAMA: "إقامة موظف", WORK_PERMIT: "رخصة عمل",
  CONTRACT_END: "عقد عمل", PROBATION_END: "فترة تجربة", LABOR_TASK: "التأمينات والأجور", TAX_TASK: "الزكاة والضريبة",
};
const PEOPLE = new Set(["IQAMA", "WORK_PERMIT", "CONTRACT_END", "PROBATION_END"]);
const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
function fold(line: string): string {
  const enc = new TextEncoder(); const out: string[] = []; let cur = ""; let len = 0;
  for (const ch of line) {
    const b = enc.encode(ch).length;
    if (len + b > 74) { out.push(cur); cur = " " + ch; len = 1 + b; } else { cur += ch; len += b; }
  }
  out.push(cur);
  return out.join("\r\n");
}
export const icsTitle = (type: string, title: string, includePeople: boolean) =>
  PEOPLE.has(type) && !includePeople ? `${title.split(" — ")[0]} — موظف` : title;

export function buildIcs(orgName: string, events: { target_type: string; target_id: string; title: string; due_date: string; link?: string | null }[],
  includePeople = false, now = new Date()): string {
  const stamp = now.toISOString().replace(/[-:]/g, "").slice(0, 15) + "Z";
  const d8 = (d: string) => d.replace(/-/g, "");
  const next = (d: string) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + 1); return x.toISOString().slice(0, 10); };
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Haseef//Compliance Calendar//AR", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    `X-WR-CALNAME:${esc(`حصيف — ${orgName}`)}`, "X-WR-TIMEZONE:Asia/Riyadh"];
  [...events].sort((a, b) => a.due_date.localeCompare(b.due_date) || a.target_type.localeCompare(b.target_type) || a.target_id.localeCompare(b.target_id))
    .forEach((e) => {
      const title = icsTitle(e.target_type, e.title, includePeople);
      lines.push("BEGIN:VEVENT", `UID:${e.target_type}-${e.target_id}-${d8(e.due_date)}@haseef.sa`, `DTSTAMP:${stamp}`,
        `DTSTART;VALUE=DATE:${d8(e.due_date)}`, `DTEND;VALUE=DATE:${d8(next(e.due_date))}`, `SUMMARY:${esc(title)}`,
        `DESCRIPTION:${esc(`${ICS_TYPE_LABEL[e.target_type] ?? ""} — من منصة حصيف`)}`);
      if (e.link) lines.push(`URL:${e.link}`);
      lines.push("BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${esc(title)}`, "TRIGGER:-P1D", "END:VALARM", "END:VEVENT");
    });
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}
