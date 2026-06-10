import { NextRequest, NextResponse } from "next/server";
import {
  getApiCallerProfile,
  isApiAssistantRole,
  isApiStaffRole,
} from "@/lib/auth/api-session";
import { getAdminClient } from "@/lib/supabase/admin";
import { checkInAppointmentToQueue } from "@/lib/services/appointment-check-in";

/** POST { appointment_id } — دخول المراجع لغرفة الانتظار + إشعار الطبيب */
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
    if (!appointmentId) {
      return NextResponse.json({ error: "appointment_id مطلوب" }, { status: 400 });
    }

    const admin = getAdminClient();
    const result = await checkInAppointmentToQueue(
      admin,
      profile.clinic_id as string,
      appointmentId
    );

    return NextResponse.json({
      success: true,
      status: result.status,
      queue_entry_id: result.queueEntryId,
    });
  } catch (err) {
    console.error("[operations/check-in]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "خطأ" },
      { status: 500 }
    );
  }
}
