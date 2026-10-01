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
  const [mustChange, setMustChange] = useState(false);
  const [newPw, setNewPw] = useState("");
  const [newPw2, setNewPw2] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { access_token, must_change_password } = await api.login(email, password);
      setSession({ token: access_token });
      if (must_change_password) {
        setMustChange(true);
        return;
      }
      await afterLogin(access_token);
    } catch (err) {
      setError(err instanceof Error ? err.message : "تعذّر تسجيل الدخول");
    } finally {
      setBusy(false);
    }
  }

  async function afterLogin(access_token: string) {
    const me = await api.me();
    if (me.memberships.length === 0) {
      setSession(null);
      setError("حسابك غير مرتبط بأي منشأة بعد. اطلب من مدير منشأتك دعوتك.");
      return;
    }
    setSession({ token: access_token, orgId: me.memberships[0].org_id });
    router.replace("/");
  }

  async function changeAndContinue(e: React.FormEvent) {
    e.preventDefault();
    if (newPw !== newPw2) { setError("كلمتا المرور غير متطابقتين"); return; }
    setBusy(true);
    setError(null);
    try {
      await api.changePassword(password, newPw);
      setPassword(newPw);
      setMustChange(false);
      // دخول جديد بكلمة المرور الجديدة للحصول على جلسة كاملة الصلاحية
      const { access_token } = await api.login(email, newPw);
      setSession({ token: access_token });
      await afterLogin(access_token);
    } catch (err) {
      setError(err instanceof Error ? err.message : "تعذّر تغيير كلمة المرور");
    } finally {
      setBusy(false);
    }
  }

  if (mustChange) {
    return (
      <main className="login">
        <form className="login-form" onSubmit={changeAndContinue}>
          <h1>عيّن كلمة مرورك</h1>
          <p className="muted">دخلت بكلمة مرور مؤقتة. اختر كلمة مرور جديدة من 10 أحرف على الأقل.</p>
          <div className="field">
            <label htmlFor="np">كلمة المرور الجديدة</label>
            <input id="np" type="password" dir="ltr" autoComplete="new-password" required minLength={10}
                   value={newPw} onChange={(e) => setNewPw(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="np2">أعد كتابتها</label>
            <input id="np2" type="password" dir="ltr" autoComplete="new-password" required minLength={10}
                   value={newPw2} onChange={(e) => setNewPw2(e.target.value)} />
          </div>
          {error && <p className="error" role="alert">{error}</p>}
          <button className="btn" type="submit" disabled={busy || newPw.length < 10 || newPw2.length < 10}>
            {busy ? "جارٍ الحفظ…" : "احفظ وادخل"}
          </button>
        </form>
      </main>
    );
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
