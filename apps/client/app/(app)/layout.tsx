"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { PLAN_LABEL, PLATFORM_LEGAL_PAGES, countDays, type Me, type OnboardingState } from "@haseef/shared";
import {
  BellMessage, BookOpen, BuildingBadge, BuildingsGroup, CardReceipt, DocSeal, FileSparkle, FingerprintShield, GavelDocument, ListCheck, Radar, ReceiptPercent, ReportChart, Scales, UsersContract, ChatBot, MapPinCheck, CalendarStar, Suitcase, DocMinus, Chevron,
} from "@/components/Icons";
import { Logo } from "@/components/Logo";
import { api, getSession, setSession } from "@/lib/session";

// القائمة مجمّعة في أقسام منسدلة؛ القسم الذي فيه الصفحة الحالية يُفتح تلقائياً.
type Item = { href: string; label: string; Icon: typeof Radar };
type Group = { key: string; label: string; Icon: typeof Radar; items: Item[] };
const HOME: Item = { href: "/", label: "الرادار العام", Icon: Radar };
const GROUPS: Group[] = [
  { key: "compliance", label: "الامتثال", Icon: BuildingBadge, items: [
    { href: "/licenses", label: "الامتثال والتراخيص", Icon: BuildingBadge },
    { href: "/obligations", label: "الالتزامات النظامية", Icon: ListCheck },
    { href: "/tax", label: "الزكاة والضريبة", Icon: ReceiptPercent },
    { href: "/pdpl", label: "حماية البيانات PDPL", Icon: FingerprintShield },
  ] },
  { key: "governance", label: "الحوكمة", Icon: GavelDocument, items: [
    { href: "/governance", label: "الحوكمة وهيكل الشركة", Icon: GavelDocument },
    { href: "/policies", label: "السياسات الداخلية", Icon: DocSeal },
    { href: "/group", label: "المجموعة والمنشآت", Icon: BuildingsGroup },
    { href: "/reports", label: "تقرير المجلس", Icon: ReportChart },
  ] },
  { key: "hr", label: "الموارد البشرية", Icon: UsersContract, items: [
    { href: "/labor", label: "الموظفون والتأمينات", Icon: UsersContract },
    { href: "/attendance", label: "الحضور والانصراف", Icon: MapPinCheck },
    { href: "/hr", label: "الإجازات والمباشرة", Icon: Suitcase },
    { href: "/hr?tab=deductions", label: "الخصومات والجزاءات", Icon: DocMinus },
    { href: "/bot", label: "بوت الموظفين", Icon: ChatBot },
    { href: "/events", label: "تقويم المناسبات", Icon: CalendarStar },
  ] },
  { key: "legal", label: "القانوني", Icon: Scales, items: [
    { href: "/library", label: "المكتبة المرجعية", Icon: BookOpen },
    { href: "/legal", label: "استشارة محامٍ", Icon: Scales },
    { href: "/contracts", label: "فاحص العقود", Icon: FileSparkle },
  ] },
  { key: "account", label: "الحساب", Icon: CardReceipt, items: [
    { href: "/alerts", label: "التنبيهات والواتساب", Icon: BellMessage },
    { href: "/billing", label: "الاشتراك والدفعات", Icon: CardReceipt },
  ] },
];
const OPEN_KEY = "haseef.nav.open";

function isActive(href: string, path: string, tab: string | null): boolean {
  if (href === "/") return path === "/";
  const [base, q] = href.split("?tab=");
  if (!path.startsWith(base)) return false;
  if (base === "/hr") return q ? tab === q : tab !== "deductions";
  return true;
}

function SideNav({ badges }: { badges: Record<string, number> }) {
  const path = usePathname();
  const tab = useSearchParams().get("tab");
  const [open, setOpen] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem(OPEN_KEY) ?? "[]") as string[]); } catch { return new Set(); }
  });
  const activeGroup = GROUPS.find((g) => g.items.some((i) => isActive(i.href, path, tab)))?.key;
  useEffect(() => {
    if (activeGroup) setOpen((o) => (o.has(activeGroup) ? o : new Set(o).add(activeGroup)));
  }, [activeGroup]);
  function toggle(k: string) {
    setOpen((o) => {
      const n = new Set(o);
      if (n.has(k)) n.delete(k); else n.add(k);
      try { localStorage.setItem(OPEN_KEY, JSON.stringify(Array.from(n))); } catch { /* التخزين غير متاح */ }
      return n;
    });
  }
  const link = (i: Item, sub = false) => (
    <Link key={i.href} href={i.href} className={sub ? "nav-sub" : undefined} aria-current={isActive(i.href, path, tab) ? "page" : undefined}>
      <i.Icon /> <span>{i.label}</span>
      {!!badges[i.href] && <small className="nav-badge">{badges[i.href]}</small>}
    </Link>
  );
  return (
    <nav aria-label="الأقسام">
      {link(HOME)}
      {GROUPS.map((g) => {
        const isOpen = open.has(g.key);
        const total = g.items.reduce((n, i) => n + (badges[i.href] ?? 0), 0);
        return (
          <div key={g.key} className="nav-group" data-open={isOpen || undefined} data-active={activeGroup === g.key || undefined}>
            <button type="button" className="nav-head" aria-expanded={isOpen} aria-controls={`nav-${g.key}`} onClick={() => toggle(g.key)}>
              <g.Icon /> <span>{g.label}</span>
              {!isOpen && total > 0 && <small className="nav-badge">{total}</small>}
              <span className="nav-chev"><Chevron size={14} /></span>
            </button>
            <div className="nav-items" id={`nav-${g.key}`}>{g.items.map((i) => link(i, true))}</div>
          </div>
        );
      })}
    </nav>
  );
}

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
  const [badges, setBadges] = useState<Record<string, number>>({});
  const [menu, setMenu] = useState(false); // قائمة الجوال

  useEffect(() => setMenu(false), [path]);
  useEffect(() => {
    if (!menu) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMenu(false);
    window.addEventListener("keydown", onKey);
    return () => { document.body.style.overflow = prev; window.removeEventListener("keydown", onKey); };
  }, [menu]);

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
    // طلبات الإجازة المعلّقة تظهر رقماً في القائمة (بصمت إن لم تكن الإضافة مفعّلة)
    api.hrOverview().then((h) => setBadges((b) => ({ ...b, "/hr": h.stats.pending }))).catch(() => {});
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
      <aside className="side" data-menu={menu || undefined}
             onClick={(e) => { if ((e.target as HTMLElement).closest("a")) setMenu(false); }}>
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
          <button type="button" className="menu-btn" aria-expanded={menu} aria-controls="side-panel"
                  aria-label={menu ? "إغلاق القائمة" : "فتح القائمة"} onClick={() => setMenu((m) => !m)}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" aria-hidden="true">
              {menu ? <path d="M6 6l12 12M18 6 6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
            </svg>
            {!menu && Object.values(badges).some((n) => n > 0) && <span className="menu-dot" aria-hidden="true" />}
          </button>
        </div>

        <div className="side-panel" id="side-panel">
        <Suspense fallback={null}><SideNav badges={badges} /></Suspense>

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
        </div>
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
