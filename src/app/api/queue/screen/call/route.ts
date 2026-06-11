import { NextRequest, NextResponse } from "next/server";
import {
  getApiCallerProfile,
  isApiAssistantRole,
  isApiDoctorRole,
  isApiStaffRole,
} from "@/lib/auth/api-session";
import { getAdminClient } from "@/lib/supabase/admin";
import {
  resolveDoctorSpeechName,
  resolvePatientSpeechName,
} from "@/lib/queue/utils";

function staffOk(role: string) {
  return isApiStaffRole(role) || isApiAssistantRole(role);
}

/**
 * POST /api/queue/screen/call
 * إعادة نداء على شاشة انتظار المرضى فقط — يحدّث called_at ليلتقطها الشاشة.
 */
export async function POST(req: NextRequest) {
  try {
    const profile = await getApiCallerProfile(req);
    if (!profile?.clinic_id) {
      return NextResponse.json({ error: "يجب تسجيل الدخول" }, { status: 401 });
    }

    const role = String(profile.role ?? "");
    if (!staffOk(role) && !isApiDoctorRole(role)) {
      return NextResponse.json({ error: "غير مصرح" }, { status: 403 });
    }

    const body = (await req.json()) as { entry_id?: string };
    const entryId = String(body.entry_id ?? "").trim();
    if (!entryId) {
      return NextResponse.json({ error: "معرّف الدور مطلوب" }, { status: 400 });
    }

    const admin = getAdminClient();
    const { data: entry, error: fetchErr } = await admin
      .from("patient_queue")
      .select(
        `
        id, status, clinic_id, patient_name, ticket_number,
        doctor:doctors(full_name_ar),
        patient:patients(full_name_ar, speech_name_ar)
      `
      )
      .eq("id", entryId)
      .eq("clinic_id", profile.clinic_id)
      .maybeSingle();

    if (fetchErr || !entry) {
      return NextResponse.json({ error: "الدور غير موجود" }, { status: 404 });
    }

    const status = String(entry.status ?? "");
    if (status !== "called" && status !== "in_progress") {
      return NextResponse.json(
        { error: "النداء متاح فقط للمراجع المطلوب دخوله" },
        { status: 400 }
      );
    }

    const now = new Date().toISOString();
    const { error: updateErr } = await admin
      .from("patient_queue")
      .update({ called_at: now })
      .eq("id", entryId)
      .eq("clinic_id", profile.clinic_id);

    if (updateErr) {
      return NextResponse.json({ error: updateErr.message }, { status: 400 });
    }

    const patientName = resolvePatientSpeechName({
      patient: entry.patient as { full_name_ar: string; speech_name_ar?: string | null } | null,
      patient_name: entry.patient_name as string | null,
      ticket_number: entry.ticket_number as number,
    });
    const doctorName = resolveDoctorSpeechName(
      entry.doctor as { full_name_ar: string } | null
    );

    return NextResponse.json({
      success: true,
      called_at: now,
      patientName,
      doctorName,
      variant: status === "in_progress" ? "enter" : "called",
    });
  } catch (err) {
    console.error("[api/queue/screen/call]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "تعذر إرسال النداء للشاشة" },
      { status: 500 }
    );
  }
}
