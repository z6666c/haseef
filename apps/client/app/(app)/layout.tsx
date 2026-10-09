"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { PLAN_LABEL, PLATFORM_LEGAL_PAGES, countDays, type Me, type OnboardingState } from "@haseef/shared";
import {
  BellMessage, BookOpen, BuildingBadge, BuildingsGroup, CardReceipt, DocSeal, FileSparkle, FingerprintShield, GavelDocument, ListCheck, Radar, ReceiptPercent, ReportChart, Scales, UsersContract, ChatBot, MapPinCheck, CalendarStar, Suitcase,
} from "@/components/Icons";
import { Logo } from "@/components/Logo";
import { api, getSession, setSession } from "@/lib/session";

// ترتيب القائمة وأيقوناتها من دليل الهوية §3.1. الأقسام غير المبنية تظهر معطّلة مع موعدها.
const NAV: { href: string | null; label: string; Icon: typeof Radar; soon?: string }[] = [
  { href: "/", label: "الرادار العام", Icon: Radar },
  { href: "/licenses", label: "الامتثال والتراخيص", Icon: BuildingBadge },
  { href: "/obligations", label: "الالتزامات النظامية", Icon: ListCheck },
  { href: "/governance", label: "الحوكمة وهيكل الشركة", Icon: GavelDocument },
  { href: "/policies", label: "السياسات الداخلية", Icon: DocSeal },
  { href: "/library", label: "المكتبة المرجعية", Icon: BookOpen },
  { href: "/legal", label: "استشارة محامٍ", Icon: Scales },
  { href: "/labor", label: "العمل والموظفين", Icon: UsersContract },
  { href: "/tax", label: "الزكاة والضريبة", Icon: ReceiptPercent },
  { href: "/attendance", label: "الحضور بالموقع", Icon: MapPinCheck },
  { href: "/hr", label: "الإجازات والخصومات", Icon: Suitcase },
  { href: "/bot", label: "بوت الموظفين", Icon: ChatBot },
  { href: "/pdpl", label: "حماية البيانات PDPL", Icon: FingerprintShield },
  { href: "/alerts", label: "التنبيهات والواتساب", Icon: BellMessage },
  { href: "/events", label: "تقويم المناسبات", Icon: CalendarStar },
  { href: "/group", label: "المجموعة والمنشآت", Icon: BuildingsGroup },
  { href: "/reports", label: "تقرير المجلس", Icon: ReportChart },
  { href: "/billing", label: "الاشتراك والدفعات", Icon: CardReceipt },
  { href: "/contracts", label: "فاحص العقود", Icon: FileSparkle },
];

function trialLeft(ends: string): string {
  const d = Math.ceil((new Date(ends).getTime() - Date.now()) / 86_400_000);
  return d <= 0 ? "اليوم" : d === 1 ? "غداً" : `بعد ${countDays(d)}`;
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const path = usePathname();
  const [me, setMe] = useState<Me | null>(null);
  const [orgId, setOrgId] = useState<string | undefined>();
  const [plan, setPlan] = useState<{ tier: string | null; active: boolean } | null>(null);
  const [ob, setOb] = useState<OnboardingState | null>(null);
  const [resent, setResent] = useState(false);

  useEffect(() => {
    const s = getSession();
    if (!s?.token) {
      router.replace("/welcome");
      return;
    }
    setOrgId(s.orgId);
    api.me().then(setMe).catch(() => router.replace("/login"));
    api.dashboard().then((d) => setPlan({ tier: d.plan_tier, active: d.automation_active })).catch(() => {});
    api.onboarding().then(setOb).catch(() => {});
  }, [router]);

  useEffect(() => {
    if (ob?.needs_onboarding && !path.startsWith("/onboarding")) router.replace("/onboarding");
  }, [ob, path, router]);

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
      <main className="content">
        {ob && !ob.email_verified && (
          <p className="top-banner">فعّل بريدك الإلكتروني من الرابط الذي أرسلناه لك، حتى تصلك التنبيهات والفواتير.{" "}
            <button type="button" className="link-btn" disabled={resent} onClick={() => api.resendVerification().then(() => setResent(true)).catch(() => {})}>
              {resent ? "أُرسل رابط جديد" : "أرسل الرابط مرة أخرى"}</button></p>
        )}
        {ob?.billing_status === "TRIAL" && ob.ends_at && !path.startsWith("/billing") && (
          <p className="top-banner trial">تجربتك المجانية تنتهي {trialLeft(ob.ends_at)}. <Link href="/billing">اشترك الآن</Link> لتستمر التنبيهات دون انقطاع.</p>
        )}
        {children}
      </main>
    </div>
  );
}
