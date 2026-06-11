import { NextRequest, NextResponse } from "next/server";
import {
  getApiCallerProfile,
  isApiAssistantRole,
  isApiDoctorRole,
  isApiStaffRole,
} from "@/lib/auth/api-session";
import { getAdminClient } from "@/lib/supabase/admin";
import {
  getDoctorByProfileId,
  notifyAccountantsReadyForBilling,
  notifyAccountantsReadyForPayment,
} from "@/lib/queue/server";
import {
  markAppointmentReadyForBilling,
  markAppointmentReadyForPayment,
} from "@/lib/services/session-checkout";

/** POST { appointment_id } — إنهاء الكشف → جاهز للدفع */
export async function POST(req: NextRequest) {
  try {
    const profile = await getApiCallerProfile(req);
    if (!profile?.clinic_id) {
      return NextResponse.json({ error: "غير مصرح" }, { status: 401 });
    }

    const role = String(profile.role ?? "");
    const isDoctor = isApiDoctorRole(role);
    const isStaff =
      isApiStaffRole(role) || isApiAssistantRole(role);

    if (!isDoctor && !isStaff) {
      return NextResponse.json({ error: "غير مصرح" }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const appointmentId = body?.appointment_id as string | undefined;
    if (!appointmentId) {
      return NextResponse.json({ error: "appointment_id مطلوب" }, { status: 400 });
    }

    const admin = getAdminClient();
    let doctorId: string | undefined;

    if (isDoctor) {
      const doctor = await getDoctorByProfileId(profile.id);
      if (!doctor) {
        return NextResponse.json({ error: "حساب الطبيب غير مربوط" }, { status: 403 });
      }
      doctorId = doctor.id;
    }

    const today = new Date().toISOString().split("T")[0];

    if (isDoctor) {
      const status = await markAppointmentReadyForBilling(
        admin,
        profile.clinic_id as string,
        appointmentId,
        { doctorId }
      );

      const { data: entry } = await admin
        .from("patient_queue")
        .select("id")
        .eq("appointment_id", appointmentId)
        .eq("clinic_id", profile.clinic_id)
        .eq("queue_date", today)
        .maybeSingle();

      if (entry?.id) {
        await notifyAccountantsReadyForBilling(entry.id as string).catch((err) => {
          console.error("[operations/finish-examination] billing notify failed:", err);
        });
      }

      return NextResponse.json({ success: true, status });
    }

    const status = await markAppointmentReadyForPayment(
      admin,
      profile.clinic_id as string,
      appointmentId,
      { doctorId }
    );

    const { data: entry } = await admin
      .from("patient_queue")
      .select("id")
      .eq("appointment_id", appointmentId)
      .eq("clinic_id", profile.clinic_id)
      .eq("queue_date", today)
      .maybeSingle();

    if (entry?.id) {
      await notifyAccountantsReadyForPayment(entry.id as string).catch((err) => {
        console.error("[operations/finish-examination] notify failed:", err);
      });
    }

    return NextResponse.json({ success: true, status });
  } catch (err) {
    console.error("[operations/finish-examination]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "خطأ" },
      { status: 500 }
    );
  }
}
