import { NextRequest, NextResponse } from "next/server";
import { getApiCallerProfile, isApiDoctorRole } from "@/lib/auth/api-session";
import { sendWebPushToProfile, isWebPushConfigured } from "@/lib/push/server";

/** POST — اختبار إشعار Push من السيرفر (طبيب فقط) */
export async function POST(req: NextRequest) {
  try {
    if (!isWebPushConfigured()) {
      return NextResponse.json(
        { error: "Web Push غير مفعّل على السيرفر" },
        { status: 503 }
      );
    }

    const profile = await getApiCallerProfile(req);
    if (!profile || !isApiDoctorRole(profile.role)) {
      return NextResponse.json({ error: "غير مصرح" }, { status: 403 });
    }

    const result = await sendWebPushToProfile(profile.id, {
      title: "تجربة النداء 🔔",
      body: "إذا وصلك هذا الإشعار — التنبيهات تعمل حتى والتطبيق مغلق",
      url: "/doctor/queue",
      tag: "doctor-queue-test",
    });

    return NextResponse.json({
      success: result.sent > 0,
      sent: result.sent,
      attempted: result.attempted,
      configured: result.configured,
    });
  } catch (err) {
    console.error("[push/test]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "خطأ" },
      { status: 500 }
    );
  }
}
