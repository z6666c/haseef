import { BODY_TYPE_LABEL, POSITION_LABEL } from "@haseef/shared";

/** جهة حوكمة بالحد الأدنى اللازم للرسم (يقبل هيكل صفحة الحوكمة وهيكل تقرير المجلس). */
export interface ChartBody {
  id?: string;
  name: string;
  body_type: string;
  meetings_per_year?: number | null;
  members: { full_name: string; position: string; is_independent: boolean; is_executive: boolean }[];
}

/**
 * مستويات الرسم الهيكلي وفق تسلسل الحوكمة المعتاد في نظام الشركات ولائحة الحوكمة:
 * الملاك ← المجلس (أو المدير عند غياب المجلس) ← لجان المجلس ← الإدارة التنفيذية ← الوظائف الرقابية.
 * المراجعة الداخلية تتبع لجنة المراجعة وظيفياً؛ تظهر في مستوى الرقابة مع إشارة لذلك.
 */
const TIERS: { key: string; label: string; types: string[] }[] = [
  { key: "owners", label: "الملكية", types: ["OWNER", "GENERAL_ASSEMBLY", "PARTNERS_ASSEMBLY"] },
  { key: "board", label: "الإشراف", types: ["BOARD", "COMPANY_SECRETARY"] },
  { key: "committees", label: "لجان المجلس", types: ["AUDIT_COMMITTEE", "NOMINATION_REMUNERATION_COMMITTEE", "RISK_COMMITTEE", "EXECUTIVE_COMMITTEE", "OTHER_COMMITTEE"] },
  { key: "exec", label: "الإدارة", types: ["MANAGER", "EXECUTIVE_MANAGEMENT"] },
  { key: "control", label: "الرقابة والالتزام", types: ["INTERNAL_AUDIT", "COMPLIANCE_FUNCTION", "DPO"] },
];

const LEAD_POS = ["CHAIR", "HEAD"];

function Node({ b, side }: { b: ChartBody; side?: boolean }) {
  const lead = b.members.find((m) => LEAD_POS.includes(m.position)) ?? (b.members.length === 1 ? b.members[0] : undefined);
  const indep = b.members.filter((m) => m.is_independent).length;
  return (
    <div className="oc-node" data-type={b.body_type} data-side={side || undefined}>
      <strong>{b.name}</strong>
      <span className="oc-type">{BODY_TYPE_LABEL[b.body_type] ?? b.body_type}</span>
      {lead && <span className="oc-lead">{POSITION_LABEL[lead.position] ?? "عضو"}: {lead.full_name}</span>}
      <span className="oc-meta">
        {b.members.length > 0 ? `${b.members.length} ${b.members.length === 1 ? "عضو" : "أعضاء"}` : "لا أعضاء مسجلون"}
        {indep > 0 && ` · ${indep} مستقل`}
        {b.meetings_per_year ? ` · ${b.meetings_per_year} اجتماعات/سنة` : ""}
      </span>
      {b.body_type === "INTERNAL_AUDIT" && <span className="oc-note">تتبع لجنة المراجعة وظيفياً</span>}
    </div>
  );
}

export function OrgChart({ bodies, title }: { bodies: ChartBody[]; title?: string }) {
  const hasBoard = bodies.some((b) => b.body_type === "BOARD");
  // بلا مجلس إدارة: المدير يشغل مستوى الإشراف مباشرة تحت الملاك
  const tiers = TIERS.map((t) => {
    let types = t.types;
    if (!hasBoard && t.key === "board") types = [...types, "MANAGER"];
    if (!hasBoard && t.key === "exec") types = types.filter((x) => x !== "MANAGER");
    return { ...t, items: bodies.filter((b) => types.includes(b.body_type)) };
  }).filter((t) => t.items.length > 0);

  if (tiers.length === 0) return <p className="empty">لا يوجد هيكل لعرضه.</p>;

  return (
    <figure className="orgchart" aria-label={title ?? "الرسم الهيكلي"}>
      {tiers.map((t, i) => {
        const main = t.items.filter((b) => b.body_type !== "COMPANY_SECRETARY");
        const side = t.items.filter((b) => b.body_type === "COMPANY_SECRETARY");
        return (
          <div key={t.key} className="oc-tier" data-tier={t.key}>
            {i > 0 && <span className="oc-link" aria-hidden="true" />}
            <span className="oc-tier-label">{t.label}</span>
            <div className="oc-row" data-many={main.length > 1 || undefined}>
              {main.map((b, j) => <Node key={b.id ?? `${t.key}-${j}`} b={b} />)}
              {side.map((b, j) => <Node key={b.id ?? `side-${j}`} b={b} side />)}
            </div>
          </div>
        );
      })}
      <figcaption className="small muted">الرسم مبني على نوع كل جهة وتسلسل الحوكمة المعتاد؛ خطوط التبعية تقريبية حسب نوع الجهة.</figcaption>
    </figure>
  );
}
