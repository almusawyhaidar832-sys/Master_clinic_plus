import { NextRequest, NextResponse } from "next/server";
import { getApiCallerProfile } from "@/lib/auth/api-session";
import { isApiStaffRole } from "@/lib/auth/api-portal";
import { getAdminClient } from "@/lib/supabase/admin";
import { syncQueueFromAppointmentStatus } from "@/lib/services/appointment-queue-sync";

/** POST { appointment_id } — تغيير الحالة إلى in_examination (دخول للعيادة) */
export async function POST(req: NextRequest) {
  try {
    const profile = await getApiCallerProfile(req);
    if (!profile?.clinic_id) {
      return NextResponse.json({ error: "غير مصرح" }, { status: 401 });
    }
    if (!isApiStaffRole(profile.role)) {
      return NextResponse.json({ error: "غير مصرح" }, { status: 403 });
    }

    const body = await req.json();
    const appointmentId = body?.appointment_id as string | undefined;
    if (!appointmentId) {
      return NextResponse.json({ error: "appointment_id مطلوب" }, { status: 400 });
    }

    const admin = getAdminClient();
    const { data: existing } = await admin
      .from("appointments")
      .select("id, clinic_id, status")
      .eq("id", appointmentId)
      .maybeSingle();

    if (!existing || existing.clinic_id !== profile.clinic_id) {
      return NextResponse.json({ error: "الموعد غير موجود" }, { status: 404 });
    }

    if (existing.status === "cancelled" || existing.status === "completed") {
      return NextResponse.json(
        { error: "لا يمكن تسجيل دخول لموعد ملغى أو مكتمل" },
        { status: 400 }
      );
    }

    const nextStatus =
      existing.status === "waiting" || existing.status === "confirmed"
        ? "in_clinic"
        : "in_examination";

    const { error } = await admin
      .from("appointments")
      .update({ status: nextStatus })
      .eq("id", appointmentId)
      .eq("clinic_id", profile.clinic_id);

    if (error) {
      if (error.message.includes("in_clinic") || error.message.includes("in_examination")) {
        return NextResponse.json(
          {
            error:
              "حالة in_clinic غير موجودة — شغّل supabase/scripts/12-appointment-queue-cycle.sql",
          },
          { status: 500 }
        );
      }
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    await syncQueueFromAppointmentStatus(
      admin,
      appointmentId,
      profile.clinic_id,
      nextStatus
    );

    return NextResponse.json({ success: true, status: nextStatus });
  } catch (err) {
    console.error("[operations/check-in]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "خطأ" },
      { status: 500 }
    );
  }
}
