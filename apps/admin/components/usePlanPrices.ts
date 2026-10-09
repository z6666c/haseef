"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/session";

/** أسعار الباقات من «التسعير» (مصدر واحد للأسعار)، مع قيم احتياطية إن تعذّر التحميل. */
const FALLBACK: Record<string, [number, number]> = { ESSENTIAL: [219, 2190], PROFESSIONAL_GRC: [549, 5490], ENTERPRISE: [1429, 14290] };

export function usePlanPrices(): Record<string, [number, number]> {
  const [p, setP] = useState(FALLBACK);
  useEffect(() => {
    api.admin.pricing().then((d) => setP(Object.fromEntries(d.plans.map((x) => [x.tier, [x.monthly_price_sar, x.yearly_price_sar] as [number, number]]))))
      .catch(() => { /* تبقى الاحتياطية */ });
  }, []);
  return p;
}
