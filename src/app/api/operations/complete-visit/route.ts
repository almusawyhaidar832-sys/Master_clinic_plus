import { NextRequest, NextResponse } from "next/server";
import {
  getApiCallerProfile,
  isApiAssistantRole,
  isApiStaffRole,
} from "@/lib/auth/api-session";
import { getAdminClient } from "@/lib/supabase/admin";
import { completeVisitAfterPayment } from "@/lib/services/session-checkout";

/** POST — إغلاق الموعد والطابور بعد تسجيل الدفع في إدخال الجلسة */
export async function POST(req: NextRequest) {
  try {
    const profile = await getApiCallerProfile(req);
    if (!profile?.clinic_id) {
      return NextResponse.json({ error: "غير مصرح" }, { status: 401 });
    }

    const role = String(profile.role ?? "");
    if (!isApiStaffRole(role) && !isApiAssistantRole(role)) {
      return NextResponse.json({ error: "غير مصرح" }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const appointmentId = body?.appointment_id as string | undefined;
    const queueEntryId = body?.queue_entry_id as string | undefined;

    if (!appointmentId && !queueEntryId) {
      return NextResponse.json(
        { error: "appointment_id أو queue_entry_id مطلوب" },
        { status: 400 }
      );
    }

    const admin = getAdminClient();
    await completeVisitAfterPayment(admin, profile.clinic_id as string, {
      appointmentId: appointmentId ?? null,
      queueEntryId: queueEntryId ?? null,
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[operations/complete-visit]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "تعذر إغلاق الزيارة" },
      { status: 500 }
    );
  }
}
