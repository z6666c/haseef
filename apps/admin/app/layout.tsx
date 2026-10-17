import type { Metadata } from "next";
// الخطوط مستضافة مع التطبيق نفسه: لا يُحمَّل شيء من خوادم خارج المملكة
import "@fontsource/ibm-plex-sans-arabic/400.css";
import "@fontsource/ibm-plex-sans-arabic/500.css";
import "@fontsource/ibm-plex-sans-arabic/600.css";
import "@fontsource/ibm-plex-sans-arabic/700.css";
import "@fontsource/plus-jakarta-sans/400.css";
import "@fontsource/plus-jakarta-sans/600.css";
import "@fontsource/plus-jakarta-sans/700.css";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "غرفة العمليات", template: "%s | حَصيف للعمليات" },
  robots: { index: false, follow: false },
  icons: { icon: `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/icon.svg` },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl">
      <body>
        {process.env.NEXT_PUBLIC_DEMO === "1" && (
          <div className="demo-ribbon" role="note">نسخة عرض تجريبية — البيانات وهمية. جرّب التعديل بحرية: التغييرات تبقى حتى تحديث الصفحة، ولا تُرسل أي تنبيهات.</div>
        )}
        {children}
      </body>
    </html>
  );
}
