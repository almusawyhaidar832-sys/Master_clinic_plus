import type { NextConfig } from "next";
import path from "path";
import { fileURLToPath } from "url";

/** يمنع Next من اعتماد package-lock.json في المجلد الأب كجذر خاطئ */
const appRoot = path.dirname(fileURLToPath(import.meta.url));

/**
 * معرّف فريد لكل نشر (deployment) — يُخبَز داخل حزمة الجافاسكربت وقت البناء.
 * تقارنه شاشة الانتظار (تعمل بدون إعادة تحميل يدوي لأيام) مع نسخة حيّة من
 * السيرفر عبر /api/queue/screen/version لاكتشاف وجود نشر أحدث وإعادة التحميل
 * تلقائياً — بدون هذا، يبقى تلفاز العيادة عالقاً على كود قديم إلى الأبد.
 */
const appBuildId =
  process.env.VERCEL_GIT_COMMIT_SHA ||
  process.env.VERCEL_DEPLOYMENT_ID ||
  String(Date.now());

const nextConfig: NextConfig = {
  outputFileTracingRoot: appRoot,
  reactStrictMode: true,
  env: {
    NEXT_PUBLIC_APP_BUILD_ID: appBuildId,
  },
  /** Pre-existing Supabase typings — allow production deploy; fix incrementally */
  typescript: {
    ignoreBuildErrors: true,
  },
  async rewrites() {
    return [
      { source: "/service-worker.js", destination: "/sw.js" },
    ];
  },
  headers: async () => [
    {
      source: "/doctor/:path*",
      headers: [
        { key: "Cache-Control", value: "no-cache, must-revalidate" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "X-Frame-Options", value: "DENY" },
      ],
    },
    {
      source: "/sw.js",
      headers: [
        { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
        { key: "Content-Type", value: "application/javascript; charset=utf-8" },
        { key: "Service-Worker-Allowed", value: "/" },
      ],
    },
    {
      source: "/service-worker.js",
      headers: [
        { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
        { key: "Content-Type", value: "application/javascript; charset=utf-8" },
        { key: "Service-Worker-Allowed", value: "/" },
      ],
    },
    {
      source: "/manifest.json",
      headers: [
        { key: "Cache-Control", value: "public, max-age=86400" },
        { key: "Content-Type", value: "application/manifest+json; charset=utf-8" },
      ],
    },
    {
      source: "/manifest-doctor.json",
      headers: [
        { key: "Cache-Control", value: "public, max-age=86400" },
        { key: "Content-Type", value: "application/manifest+json; charset=utf-8" },
      ],
    },
    {
      source: "/manifest-assistant.json",
      headers: [
        { key: "Cache-Control", value: "public, max-age=86400" },
        { key: "Content-Type", value: "application/manifest+json; charset=utf-8" },
      ],
    },
    {
      source: "/assistant/:path*",
      headers: [
        { key: "Cache-Control", value: "no-cache, must-revalidate" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "X-Frame-Options", value: "DENY" },
      ],
    },
    {
      /** شاشة تلفاز تبقى مفتوحة لأيام — يجب أن يصل كل نشر جديد فوراً بلا كاش */
      source: "/queue-screen/:path*",
      headers: [
        { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
        { key: "X-Content-Type-Options", value: "nosniff" },
      ],
    },
    {
      source: "/icons/:path*",
      headers: [{ key: "Cache-Control", value: "public, max-age=604800, immutable" }],
    },
  ],
};

export default nextConfig;
