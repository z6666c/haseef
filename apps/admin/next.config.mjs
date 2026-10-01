/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@haseef/shared"],
  poweredByHeader: false,
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
export default nextConfig;
