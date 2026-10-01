/** @type {import('next').NextConfig} */
// نسخة العرض الثابتة (GitHub Pages): DEMO_EXPORT=1 مع NEXT_PUBLIC_DEMO=1 و NEXT_PUBLIC_BASE_PATH.
const demoExport = process.env.DEMO_EXPORT === "1";
const basePath = process.env.NEXT_PUBLIC_BASE_PATH || undefined;

const nextConfig = {
  transpilePackages: ["@haseef/shared"],
  poweredByHeader: false,
  // روابط المشاركة المؤقتة (scripts/share.sh) تفتح خادم التطوير من نطاق Cloudflare.
  allowedDevOrigins: ["*.trycloudflare.com"],
  // الواجهة والخادم من نفس الأصل: /api/* يُمرَّر للخادم. يلغي مشاكل CORS،
  // ويسمح لاحقاً بكوكي httpOnly للجلسة (لا يصل إليها أي سكربت في الصفحة).
  async rewrites() {
    const api = process.env.API_INTERNAL_URL ?? "http://127.0.0.1:8000";
    return [{ source: "/api/:path*", destination: `${api}/:path*` }];
  },
  async headers() {
    return [{
      source: "/(.*)",
      headers: [
        { key: "X-Frame-Options", value: "DENY" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      ],
    }];
  },
};
if (demoExport) {
  Object.assign(nextConfig, { output: "export", basePath, trailingSlash: true, images: { unoptimized: true } });
  delete nextConfig.rewrites; // لا خادم في الصفحات الثابتة؛ الطلبات تُخدم من demo.ts
  delete nextConfig.headers;
}
export default nextConfig;
