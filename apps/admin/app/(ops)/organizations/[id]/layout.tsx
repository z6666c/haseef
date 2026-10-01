import { DEMO_ORG_IDS } from "@haseef/shared";

// نسخة العرض الثابتة تحتاج قائمة الصفحات وقت البناء. في التشغيل العادي تُولَّد الصفحات عند الطلب.
export function generateStaticParams() {
  return process.env.DEMO_EXPORT === "1" ? DEMO_ORG_IDS.map((id) => ({ id })) : [];
}

export default function OrgLayout({ children }: { children: React.ReactNode }) {
  return children;
}
