"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { Me } from "@haseef/shared";
import { Mark } from "@/components/Mark";
import { api, getSession, setSession } from "@/lib/session";

const NAV = [
  { href: "/", label: "الرادار" },
  { href: "/licenses", label: "التراخيص" },
  // المرحلة 3: الحوكمة، حماية البيانات، مختبر العقود
];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const path = usePathname();
  const [me, setMe] = useState<Me | null>(null);
  const [orgId, setOrgId] = useState<string | undefined>();

  useEffect(() => {
    const s = getSession();
    if (!s?.token) {
      router.replace("/login");
      return;
    }
    setOrgId(s.orgId);
    api.me().then(setMe).catch(() => router.replace("/login"));
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

  return (
    <div className="shell">
      <aside className="side">
        <Link href="/" className="side-brand">
          <Mark size={30} />
          <span>حَصيف</span>
        </Link>
        <nav aria-label="الأقسام">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} aria-current={path === n.href ? "page" : undefined}>
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="side-foot">
          {me.memberships.length > 1 ? (
            <div className="field">
              <label htmlFor="org">المنشأة</label>
              <select id="org" value={orgId} onChange={(e) => switchOrg(e.target.value)}>
                {me.memberships.map((m) => <option key={m.org_id} value={m.org_id}>{m.org_name}</option>)}
              </select>
            </div>
          ) : (
            <p className="side-org">{me.memberships[0]?.org_name}</p>
          )}
          <p className="side-user">{me.full_name}</p>
          <button className="side-logout" type="button" onClick={logout}>تسجيل الخروج</button>
        </div>
      </aside>
      <main className="content">{children}</main>
    </div>
  );
}
