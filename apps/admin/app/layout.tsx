import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "غرفة العمليات", template: "%s | حَصيف للعمليات" },
  robots: { index: false, follow: false },
  icons: { icon: `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/icon.svg` },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Arabic:wght@400;500;600;700&family=Plus+Jakarta+Sans:wght@400;600;700&display=swap" />
      </head>
      <body>
        {process.env.NEXT_PUBLIC_DEMO === "1" && (
          <div className="demo-ribbon" role="note">نسخة عرض تجريبية — البيانات وهمية. جرّب التعديل بحرية: التغييرات تبقى حتى تحديث الصفحة، ولا تُرسل أي تنبيهات.</div>
        )}
        {children}
      </body>
    </html>
  );
}
