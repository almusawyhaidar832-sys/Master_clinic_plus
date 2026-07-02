import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * يعيد معرّف النشر الحالي فعلياً على السيرفر (بدون أي كاش) — تستخدمه شاشة
 * الانتظار على التلفاز لمقارنته مع نسخة الجافاسكربت المحمَّلة في المتصفح،
 * ولإعادة تحميل نفسها تلقائياً عند وجود نشر أحدث. لا يتطلب تسجيل دخول لأن
 * أجهزة التلفاز لا تحمل جلسة مستخدم.
 */
export async function GET() {
  const buildId =
    process.env.VERCEL_GIT_COMMIT_SHA ||
    process.env.VERCEL_DEPLOYMENT_ID ||
    process.env.NEXT_PUBLIC_APP_BUILD_ID ||
    "";

  return NextResponse.json(
    { buildId },
    {
      headers: {
        "Cache-Control": "no-cache, no-store, must-revalidate",
      },
    }
  );
}
