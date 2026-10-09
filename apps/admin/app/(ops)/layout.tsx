"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { AdminMe } from "@haseef/shared";
import { Mark } from "@/components/Mark";
import { RoleContext } from "@/components/ui";
import { api, getSession, setSession } from "@/lib/session";

// كل قسم يظهر لمن يملك واحدة من صلاحياته
const NAV: { href: string; label: string; perms: string[] }[] = [
  { href: "/", label: "نظرة عامة", perms: ["overview.view"] },
  { href: "/organizations", label: "المنشآت", perms: ["orgs.view", "billing.manage", "finance.view"] },
  { href: "/trials", label: "طلبات التجربة", perms: ["trials.manage"] },
  { href: "/dispatches", label: "التنبيهات", perms: ["alerts.view"] },
  { href: "/finance", label: "المالية", perms: ["finance.view", "billing.manage", "expenses.manage"] },
  { href: "/pricing", label: "التسعير", perms: ["finance.view", "billing.manage"] },
  { href: "/legal", label: "الاستشارات القانونية", perms: ["legal.cases", "legal.billing", "legal.lawyers"] },
  { href: "/content", label: "المحتوى المرجعي", perms: ["content.manage", "content.approve"] },
  { href: "/usage", label: "استهلاك الذكاء الاصطناعي", perms: ["usage.view"] },
  { href: "/team", label: "الفريق", perms: ["team.view", "team.manage"] },
  { href: "/audit", label: "سجل التدقيق", perms: ["audit.view"] },
];

export default function OpsLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const path = usePathname();
  const [name, setName] = useState<string | null>(null);
  const [role, setRole] = useState<AdminMe | null>(null);

  useEffect(() => {
    if (!getSession()?.token) { router.replace("/login"); return; }
    api.me()
      .then(async (me) => {
        if (!me.is_platform_admin) { router.replace("/login"); return; }
        setName(me.full_name);
        setRole(await api.admin.me());
      })
      .catch(() => router.replace("/login"));
  }, [router]);

  if (!name || !role) return null;
  const active = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));
  const nav = NAV.filter((n) => role.role === "SUPER_ADMIN" || n.perms.some((p) => role.permissions.includes(p)));
  const current = NAV.find((n) => n.href !== "/" && active(n.href)) ?? (path === "/" ? NAV[0] : undefined);
  const allowed = !current || nav.includes(current);

  return (
    <RoleContext.Provider value={role}>
      <div className="ops">
        <header className="ops-bar">
          <Link href="/" className="ops-brand"><Mark size={24} /><span>غرفة العمليات</span></Link>
          <nav aria-label="الأقسام">
            {nav.map((n) => (
              <Link key={n.href} href={n.href} aria-current={active(n.href) ? "page" : undefined}>{n.label}</Link>
            ))}
          </nav>
          <span className="ops-user"><span className="ops-user-name">{name}</span> <span className="ops-role">{role.role_name}</span></span>
          <button className="ops-logout" type="button" onClick={() => { setSession(null); router.replace("/login"); }}>خروج</button>
        </header>
        <main className="ops-main">
          {allowed ? children : nav.length
            ? <p className="hint">هذا القسم غير متاح لدورك. <Link href={nav[0].href}>انتقل إلى {nav[0].label}</Link></p>
            : <p className="hint">لم تُمنح أي صلاحية بعد. تواصل مع المدير العام.</p>}
        </main>
      </div>
    </RoleContext.Provider>
  );
}
