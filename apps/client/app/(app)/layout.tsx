"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { PLAN_LABEL, PLATFORM_LEGAL_PAGES, type Me } from "@haseef/shared";
import {
  BellMessage, BookOpen, BuildingBadge, BuildingsGroup, DocSeal, FileSparkle, FingerprintShield, GavelDocument, ListCheck, Radar, ReportChart, Scales,
} from "@/components/Icons";
import { Logo } from "@/components/Logo";
import { api, getSession, setSession } from "@/lib/session";

// ترتيب القائمة وأيقوناتها من دليل الهوية §3.1. الأقسام غير المبنية تظهر معطّلة مع موعدها.
const NAV = [
  { href: "/", label: "الرادار العام", Icon: Radar },
  { href: "/licenses", label: "الامتثال والتراخيص", Icon: BuildingBadge },
  { href: "/obligations", label: "الالتزامات النظامية", Icon: ListCheck },
  { href: "/governance", label: "الحوكمة وهيكل الشركة", Icon: GavelDocument },
  { href: "/policies", label: "السياسات الداخلية", Icon: DocSeal },
  { href: "/library", label: "المكتبة المرجعية", Icon: BookOpen },
  { href: "/legal", label: "استشارة محامٍ", Icon: Scales },
  { href: "/pdpl", label: "حماية البيانات PDPL", Icon: FingerprintShield },
  { href: "/alerts", label: "التنبيهات والواتساب", Icon: BellMessage },
  { href: "/group", label: "المجموعة والمنشآت", Icon: BuildingsGroup },
  { href: "/reports", label: "تقرير المجلس", Icon: ReportChart },
  { href: null, label: "فاحص العقود بالذكاء الاصطناعي", Icon: FileSparkle, soon: "المرحلة 2" },
];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const path = usePathname();
  const [me, setMe] = useState<Me | null>(null);
  const [orgId, setOrgId] = useState<string | undefined>();
  const [plan, setPlan] = useState<{ tier: string | null; active: boolean } | null>(null);

  useEffect(() => {
    const s = getSession();
    if (!s?.token) {
      router.replace("/welcome");
      return;
    }
    setOrgId(s.orgId);
    api.me().then(setMe).catch(() => router.replace("/login"));
    api.dashboard().then((d) => setPlan({ tier: d.plan_tier, active: d.automation_active })).catch(() => {});
  }, [router]);

  function switchOrg(id: string) {
    const s = getSession();
    if (!s) return;
    setSession({ ...s, orgId: id });
    setOrgId(id);
    window.location.reload(); // كل البيانات مقيّدة بالمنشأة؛ إعادة تحميل كاملة أسلم من تحديث جزئي
  }

  function logout() {
    setSession(null);
    router.replace("/login");
  }

  if (!me) return <div className="boot" aria-busy="true" />;
  const current = me.memberships.find((m) => m.org_id === orgId) ?? me.memberships[0];

  return (
    <div className="shell">
      <aside className="side">
        <div className="side-top">
          <Link href="/" className="side-brand" aria-label="حَصيف — الرادار العام">
            <Logo variant="compact" tone="light" />
          </Link>
          {plan && (
            <span className="pulse" data-on={plan.active}
                  title={plan.active ? "التنبيهات التلقائية تعمل" : "التنبيهات التلقائية متوقفة: الاشتراك غير فعّال"}>
              <span className="sr-only">{plan.active ? "التنبيهات التلقائية تعمل" : "التنبيهات التلقائية متوقفة"}</span>
            </span>
          )}
        </div>

        <nav aria-label="الأقسام">
          {NAV.map(({ href, label, Icon, soon }) =>
            href ? (
              <Link key={label} href={href} aria-current={(href === "/" ? path === "/" : path.startsWith(href)) ? "page" : undefined}>
                <Icon /> <span>{label}</span>
              </Link>
            ) : (
              <span key={label} className="nav-soon" aria-disabled="true">
                <Icon /> <span>{label}</span> <small>{soon}</small>
              </span>
            ),
          )}
        </nav>

        <div className="org-card">
          <p className="org-name">{current?.org_name}</p>
          <p className="org-cr">السجل التجاري <span dir="ltr">{current?.cr_number}</span></p>
          {plan?.tier && <p className="org-plan">{PLAN_LABEL[plan.tier] ?? plan.tier}</p>}
          {me.memberships.length > 1 && (
            <div className="field">
              <label htmlFor="org">التبديل إلى منشأة أخرى</label>
              <select id="org" value={current?.org_id} onChange={(e) => switchOrg(e.target.value)}>
                {me.memberships.map((m) => <option key={m.org_id} value={m.org_id}>{m.org_name}</option>)}
              </select>
            </div>
          )}
          <div className="org-user">
            <span>{me.full_name}</span>
            <button type="button" onClick={logout}>تسجيل الخروج</button>
          </div>
        </div>
        <nav className="side-legal" aria-label="الوثائق القانونية">
          {PLATFORM_LEGAL_PAGES.map((p) => <Link key={p.key} href={p.href}>{p.short}</Link>)}
        </nav>
      </aside>
      <main className="content">{children}</main>
    </div>
  );
}
