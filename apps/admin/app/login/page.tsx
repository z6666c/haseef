"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Mark } from "@/components/Mark";
import { api, setSession } from "@/lib/session";

export default function AdminLogin() {
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
      if (!me.is_platform_admin) {
        setSession(null);
        setError("هذه البوابة لفريق حصيف. عملاء المنصة يدخلون من app.haseef.sa");
        return;
      }
      router.replace("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "تعذّر تسجيل الدخول");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login">
      <form className="login-form" onSubmit={submit} noValidate>
        <div className="login-brand"><Mark size={40} /><span>غرفة العمليات</span></div>
        <div className="field">
          <label htmlFor="email">البريد الإلكتروني</label>
          <input id="email" type="email" dir="ltr" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="password">كلمة المرور</label>
          <input id="password" type="password" dir="ltr" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        {error && <p className="error" role="alert">{error}</p>}
        <button className="btn" type="submit" disabled={busy || !email || password.length < 8}>{busy ? "جارٍ الدخول…" : "ادخل"}</button>
      </form>
    </main>
  );
}
