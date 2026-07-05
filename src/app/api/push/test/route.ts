import { NextRequest, NextResponse } from "next/server";
import {
  getApiCallerProfile,
  isApiAssistantRole,
  isApiDoctorRole,
  isApiStaffRole,
} from "@/lib/auth/api-session";
import { sendWebPushToProfile, isWebPushConfigured } from "@/lib/push/server";

/** POST — اختبار إشعار Push من السيرفر (طبيب / مساعد / محاسب) */
export async function POST(req: NextRequest) {
  try {
    if (!isWebPushConfigured()) {
      return NextResponse.json(
        { error: "Web Push غير مفعّل على السيرفر" },
        { status: 503 }
      );
    }

    const profile = await getApiCallerProfile(req);
    const role = profile?.role ?? "";
    if (
      !profile ||
      (!isApiDoctorRole(role) &&
        !isApiAssistantRole(role) &&
        !isApiStaffRole(role))
    ) {
      return NextResponse.json({ error: "غير مصرح" }, { status: 403 });
    }

    const url = isApiStaffRole(role)
      ? "/dashboard/queue"
      : isApiAssistantRole(role)
        ? "/assistant/queue"
        : "/doctor/queue";
    const tag = isApiStaffRole(role)
      ? "accountant-queue-test"
      : isApiAssistantRole(role)
        ? "assistant-queue-test"
        : "doctor-queue-test";
    const kind = isApiStaffRole(role) ? "accountant_admit" : "doctor_queue";

    const result = await sendWebPushToProfile(profile.id, {
      title: "تجربة النداء 🔔",
      body: "إذا وصلك هذا الإشعار — التنبيهات تعمل حتى والتطبيق في تبويب آخر",
      url,
      tag,
      kind,
      patientName: "أحمد",
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
