"use client";

import { createApi, type Session } from "@haseef/shared";

const KEY = "haseef.admin.session";

// المرحلة 1: التوكن في sessionStorage (يُمسح بإغلاق التبويب).
// قبل الإطلاق ينتقل إلى كوكي httpOnly يضبطه الخادم، حتى لا يصل إليه أي سكربت في الصفحة.
export function getSession(): Session | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

export function setSession(s: Session | null): void {
  try {
    if (s) window.sessionStorage.setItem(KEY, JSON.stringify(s));
    else window.sessionStorage.removeItem(KEY);
  } catch { /* التخزين غير متاح */ }
}

export const api = createApi(
  process.env.NEXT_PUBLIC_API_URL ?? "/api",
  getSession,
  () => {
    setSession(null);
    if (typeof window !== "undefined" && !window.location.pathname.startsWith("/login")) {
      window.location.href = "/login";
    }
  },
);
