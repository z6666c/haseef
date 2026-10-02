"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { PLATFORM_ROLE_LABEL, type PlatformRole } from "@haseef/shared";
import { Mark } from "@/components/Mark";
import { RoleContext } from "@/components/ui";
import { api, getSession, setSession } from "@/lib/session";

const NAV: { href: string; label: string; roles?: PlatformRole[] }[] = [
  { href: "/", label: "نظرة عامة" },
  { href: "/organizations", label: "المنشآت" },
  { href: "/dispatches", label: "التنبيهات", roles: ["SUPPORT"] },
  { href: "/content", label: "المحتوى المرجعي", roles: ["SUPPORT"] },
  { href: "/usage", label: "استهلاك الذكاء الاصطناعي" },
  { href: "/team", label: "الفريق", roles: ["SUPPORT"] },
  { href: "/audit", label: "سجل التدقيق" },
];

export default function OpsLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const path = usePathname();
  const [name, setName] = useState<string | null>(null);
  const [role, setRole] = useState<PlatformRole | null>(null);

  useEffect(() => {
    if (!getSession()?.token) { router.replace("/login"); return; }
    api.me()
      .then(async (me) => {
        if (!me.is_platform_admin) { router.replace("/login"); return; }
        setName(me.full_name);
        setRole((await api.admin.me()).role);
      })
      .catch(() => router.replace("/login"));
  }, [router]);

  if (!name || !role) return null;
  const active = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));

  return (
    <RoleContext.Provider value={role}>
      <div className="ops">
        <header className="ops-bar">
          <Link href="/" className="ops-brand"><Mark size={24} /><span>غرفة العمليات</span></Link>
          <nav aria-label="الأقسام">
            {NAV.filter((n) => !n.roles || role === "SUPER_ADMIN" || n.roles.includes(role)).map((n) => (
              <Link key={n.href} href={n.href} aria-current={active(n.href) ? "page" : undefined}>{n.label}</Link>
            ))}
          </nav>
          <span className="ops-user"><span className="ops-user-name">{name}</span> <span className="ops-role">{PLATFORM_ROLE_LABEL[role]}</span></span>
          <button className="ops-logout" type="button" onClick={() => { setSession(null); router.replace("/login"); }}>خروج</button>
        </header>
        <main className="ops-main">{children}</main>
      </div>
    </RoleContext.Provider>
  );
}
