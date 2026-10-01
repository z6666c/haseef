"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Mark } from "@/components/Mark";
import { api, getSession, setSession } from "@/lib/session";

const NAV = [
  { href: "/", label: "نظرة عامة" },
  { href: "/organizations", label: "المنشآت" },
  { href: "/dispatches", label: "التنبيهات" },
  { href: "/usage", label: "استهلاك الذكاء الاصطناعي" },
];

export default function OpsLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const path = usePathname();
  const [name, setName] = useState<string | null>(null);

  useEffect(() => {
    if (!getSession()?.token) { router.replace("/login"); return; }
    api.me()
      .then((me) => (me.is_platform_admin ? setName(me.full_name) : router.replace("/login")))
      .catch(() => router.replace("/login"));
  }, [router]);

  if (!name) return null;

  return (
    <div className="ops">
      <header className="ops-bar">
        <Link href="/" className="ops-brand"><Mark size={24} /><span>غرفة العمليات</span></Link>
        <nav aria-label="الأقسام">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} aria-current={path === n.href ? "page" : undefined}>{n.label}</Link>
          ))}
        </nav>
        <span className="ops-user">{name}</span>
        <button className="ops-logout" type="button" onClick={() => { setSession(null); router.replace("/login"); }}>خروج</button>
      </header>
      <main className="ops-main">{children}</main>
    </div>
  );
}
