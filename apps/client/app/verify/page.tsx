"use client";

import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Logo } from "@/components/Logo";
import { api } from "@/lib/session";

function Verify() {
  const token = useSearchParams().get("token");
  const [state, setState] = useState<"busy" | "ok" | "bad">("busy");
  const [msg, setMsg] = useState("");
  useEffect(() => {
    if (!token) { setState("bad"); setMsg("الرابط ناقص."); return; }
    api.verifyEmail(token).then(() => setState("ok")).catch((e: Error) => { setState("bad"); setMsg(e.message); });
  }, [token]);
  return (
    <main className="login">
      <div className="login-brand"><Logo variant="full" tone="light" /></div>
      <div className="login-form">
        {state === "busy" && <p aria-busy="true">جارٍ تفعيل بريدك…</p>}
        {state === "ok" && <><h1>تم تفعيل بريدك</h1><p className="muted">ستصلك التنبيهات والفواتير على هذا البريد.</p><Link className="btn" href="/">إلى حصيف</Link></>}
        {state === "bad" && <><h1>تعذّر التفعيل</h1><p className="error">{msg}</p><Link className="btn btn-quiet" href="/login">سجّل الدخول واطلب رابطاً جديداً</Link></>}
      </div>
    </main>
  );
}

export default function VerifyPage() {
  return <Suspense fallback={null}><Verify /></Suspense>;
}
