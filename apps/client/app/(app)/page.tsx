"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { RESOLUTION_STATUS_LABEL, formatDate, type ComplianceItem, type Dashboard } from "@haseef/shared";
import { DeadlinesTable } from "@/components/DeadlinesTable";
import { BuildingBadge, External, FileSparkle, FingerprintShield, GavelDocument, Plus } from "@/components/Icons";
import { ScoreCard } from "@/components/ScoreCard";
import { api } from "@/lib/session";

function firstName(full: string) {
  return full.split(/\s+/)[0] ?? full;
}

export default function RadarPage() {
  const [d, setD] = useState<Dashboard | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api.dashboard().then(setD).catch((e: Error) => setError(e.message));
  }, []);
  useEffect(load, [load]);

  async function remind(it: ComplianceItem) {
    const r = await api.remindNow(it.id);
    return r.message;
  }
  async function renew(it: ComplianceItem, date: string) {
    await api.renewItem(it.id, date);
    load();
  }

  if (error) return <p className="error" role="alert">{error}</p>;
  if (!d) return <div className="boot" aria-busy="true" />;
  const { counts, governance: gov, pdpl } = d;
  const total = counts.active + counts.expiring_soon + counts.expired;

  return (
    <>
      <header className="page-head page-head-row">
        <div>
          <h1>مرحباً، {firstName(d.greeting_name)}</h1>
          <p className="muted">{d.org_name}</p>
        </div>
        <div className="head-actions">
          <Link className="btn btn-action" href="/licenses?new=1"><Plus size={18} /> إضافة ترخيص</Link>
          <Link className="btn btn-quiet" href="/contracts"><FileSparkle size={18} /> فحص عقد</Link>
        </div>
      </header>

      <ScoreCard score={d.score} />

      <div className="columns">
        <section className="col" aria-labelledby="c-lic">
          <h2 id="c-lic"><BuildingBadge /> التراخيص</h2>
          {total === 0 ? (
            <p className="muted">لا تراخيص مسجلة بعد. <Link href="/licenses?new=1">أضف أول ترخيص</Link></p>
          ) : (
            <dl className="col-stats">
              <div><dt>سارية</dt><dd data-s="ACTIVE">{counts.active}</dd></div>
              <div><dt>قاربت</dt><dd data-s="EXPIRING_SOON">{counts.expiring_soon}</dd></div>
              <div><dt>منتهية</dt><dd data-s="EXPIRED">{counts.expired}</dd></div>
            </dl>
          )}
          <p className="col-links">
            <a href="https://balady.gov.sa" target="_blank" rel="noopener noreferrer">بلدي <External size={14} /></a>
            <a href="https://qiwa.sa" target="_blank" rel="noopener noreferrer">قوى <External size={14} /></a>
          </p>
        </section>

        <section className="col" aria-labelledby="c-gov">
          <h2 id="c-gov"><GavelDocument /> الحوكمة</h2>
          {!gov.available ? (
            <p className="muted">متاحة في باقة الحوكمة والنمو.</p>
          ) : (
            <dl className="col-facts">
              <div>
                <dt>آخر اجتماع للشركاء</dt>
                <dd>{gov.last_meeting_date
                  ? <>{gov.last_meeting_title}، <span dir="ltr">{formatDate(gov.last_meeting_date)}</span>{gov.last_meeting_status && <> ({RESOLUTION_STATUS_LABEL[gov.last_meeting_status] ?? gov.last_meeting_status})</>}</>
                  : <span className="muted">لم يُسجَّل أي اجتماع</span>}</dd>
              </div>
              <div>
                <dt>هيكل الحوكمة</dt>
                <dd><Link href="/governance">الهيكل ونتيجة الفحص ←</Link></dd>
              </div>
              <div>
                <dt>مصفوفة الصلاحيات</dt>
                <dd>{gov.doa_rules > 0
                  ? <>{gov.doa_rules} تفويض ساري، آخر تحديث <span dir="ltr">{formatDate(gov.doa_last_updated!)}</span></>
                  : <span className="muted">لم تُعرَّف بعد</span>}</dd>
              </div>
            </dl>
          )}
        </section>

        <section className="col" aria-labelledby="c-pdpl">
          <h2 id="c-pdpl"><FingerprintShield /> حماية البيانات</h2>
          {!pdpl.available ? (
            <p className="muted">متاحة في باقة الحوكمة والنمو.</p>
          ) : pdpl.completeness_pct === null ? (
            <p className="muted">سجل أنشطة المعالجة فارغ. <Link href="/pdpl">أضف أنشطتك الشائعة بنقرة ←</Link></p>
          ) : (
            <>
              <p className="col-big"><b dir="ltr">{pdpl.completeness_pct}%</b> اكتمال سجل المعالجة</p>
              <meter min={0} max={100} value={pdpl.completeness_pct} aria-label="اكتمال سجل المعالجة" />
              <p className="muted small">{pdpl.complete_records} من {pdpl.records} نشاطاً مكتمل البيانات{pdpl.cross_border > 0 && `، ${pdpl.cross_border} بنقل خارج المملكة`}</p>
              <p className="small"><Link href="/pdpl">السجل والطلبات والحوادث ←</Link></p>
            </>
          )}
        </section>
      </div>

      <section className="emergency" aria-labelledby="em-title">
        <div className="section-head">
          <h2 id="em-title">جدول الطوارئ</h2>
          <p className="muted">ما ينتهي خلال 15 يوماً أو انتهى فعلاً، الأخطر أولاً</p>
        </div>
        {d.action_required.length === 0 ? (
          <p className="empty">لا شيء عاجل. أقرب موعد خارج نافذة الخمسة عشر يوماً.</p>
        ) : (
          <DeadlinesTable items={d.action_required} onRemind={remind} onRenew={renew} />
        )}
      </section>
    </>
  );
}
