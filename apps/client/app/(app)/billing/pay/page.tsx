"use client";

import Link from "next/link";
import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { sar, type PaymentIntent } from "@haseef/shared";
import { api } from "@/lib/session";

function Pay() {
  const sp = useSearchParams();
  const id = sp.get("intent");
  const sandbox = sp.get("sandbox") === "1";
  const [it, setIt] = useState<PaymentIntent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => { if (id) api.checkoutStatus(id).then(setIt).catch((e: Error) => setError(e.message)); }, [id]);
  useEffect(load, [load]);
  useEffect(() => {                                // عودة من البوابة: نتحقق كل ثلاث ثوانٍ حتى تتأكد الحالة
    if (!it || it.status !== "INITIATED" || sandbox) return;
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [it, sandbox, load]);
  if (!id) return <p className="error">رقم العملية غير محدد.</p>;
  if (error) return <p className="error" role="alert">{error}</p>;
  if (!it) return <div className="boot" aria-busy="true" />;

  return (
    <section className="panel inline-form" style={{ maxWidth: 520 }}>
      <h1>{it.status === "PAID" ? "تم الدفع بنجاح" : it.status === "FAILED" ? "لم يكتمل الدفع" : "إتمام الدفع"}</h1>
      <dl className="ropa-facts">
        <div><dt>البيان</dt><dd>{it.description}</dd></div>
        <div><dt>قبل الضريبة</dt><dd>{sar(it.amount_net)}</dd></div>
        <div><dt>الضريبة</dt><dd>{sar(it.vat_amount)}</dd></div>
        <div><dt>الإجمالي</dt><dd><b>{sar(it.total)}</b></dd></div>
      </dl>
      {it.status === "PAID" && <p className="notice">صدرت فاتورتك الضريبية، وتجدها في «الاشتراك والدفعات». أُرسل الإيصال إلى بريدك.</p>}
      {it.status === "FAILED" && <p className="error">لم تتم العملية ولم يُخصم أي مبلغ. يمكنك المحاولة مرة أخرى.</p>}
      {it.status === "INITIATED" && sandbox && (
        <div className="panel sandbox">
          <p><b>بوابة دفع تجريبية</b> — في الإنتاج تنتقل هنا إلى صفحة الدفع الآمنة (مدى، فيزا، Apple Pay).</p>
          <button className="btn btn-action" type="button" disabled={busy}
            onClick={async () => { setBusy(true); try { setIt(await api.sandboxPay(it.id)); } catch (e) { setError(e instanceof Error ? e.message : "تعذّر"); } finally { setBusy(false); } }}>
            {busy ? "جارٍ الدفع…" : `ادفع ${sar(it.total)} (تجريبي)`}</button>
        </div>
      )}
      {it.status === "INITIATED" && !sandbox && <p className="muted" aria-busy="true">ننتظر تأكيد البوابة…</p>}
      <Link className="btn btn-quiet" href="/billing">العودة إلى الاشتراك والدفعات</Link>
    </section>
  );
}

export default function PayPage() {
  return <Suspense fallback={null}><Pay /></Suspense>;
}
