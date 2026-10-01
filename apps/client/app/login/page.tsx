"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Logo } from "@/components/Logo";
import { api, setSession } from "@/lib/session";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { access_token } = await api.login(email, password);
      setSession({ token: access_token });
      const me = await api.me();
      if (me.memberships.length === 0) {
        setSession(null);
        setError("حسابك غير مرتبط بأي منشأة بعد. اطلب من مدير منشأتك دعوتك.");
        return;
      }
      setSession({ token: access_token, orgId: me.memberships[0].org_id });
      router.replace("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "تعذّر تسجيل الدخول");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login">
      <div className="login-brand">
        <Logo variant="full" tone="light" />
        <p className="login-tagline">شريكك الحكيم لإدارة الحوكمة والالتزام وحماية المنشأة</p>
      </div>
      <form className="login-form" onSubmit={submit} noValidate>
        <h1>الدخول إلى منشأتك</h1>
        <div className="field">
          <label htmlFor="email">البريد الإلكتروني</label>
          <input id="email" type="email" dir="ltr" autoComplete="username" required
                 value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="password">كلمة المرور</label>
          <input id="password" type="password" dir="ltr" autoComplete="current-password" required minLength={8}
                 value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        {error && <p className="error" role="alert">{error}</p>}
        <button className="btn" type="submit" disabled={busy || !email || password.length < 8}>
          {busy ? "جارٍ الدخول…" : "ادخل"}
        </button>
      </form>
    </main>
  );
}
