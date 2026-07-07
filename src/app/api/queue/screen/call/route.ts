import { NextRequest, NextResponse } from "next/server";
import {
  isApiAssistantRole,
  isApiDoctorRole,
  isApiStaffRole,
} from "@/lib/auth/api-session";
import { getAdminClient } from "@/lib/supabase/admin";
import { resolveQueueApiAccess } from "@/lib/queue/api-access";
import { emitQueueScreenCall, emitQueueScreenSync } from "@/lib/queue/server";
import { buildQueueAnnounceAudioUrl } from "@/lib/queue/queue-announce-audio-url";
import {
  resolveDoctorSpeechName,
  resolvePatientSpeechName,
} from "@/lib/queue/utils";

function staffOk(role: string) {
  return isApiStaffRole(role) || isApiAssistantRole(role);
}

const ENTRY_SELECT = `
  id, status, clinic_id, patient_name, ticket_number,
  doctor:doctors!doctor_id(full_name_ar),
  patient:patients(full_name_ar, speech_name_ar, gender)
`;

/**
 * POST /api/queue/screen/call
 * إعادة نداء على شاشة انتظار المرضى — يحدّث called_at ليلتقطها الشاشة.
 */
export async function POST(req: NextRequest) {
  try {
    const access = await resolveQueueApiAccess(req);
    if (!access.ok) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const role = String(access.profile.role ?? "");
    if (!staffOk(role) && !isApiDoctorRole(role)) {
      return NextResponse.json({ error: "غير مصرح" }, { status: 403 });
    }

    const body = (await req.json()) as { entry_id?: string };
    const entryId = String(body.entry_id ?? "").trim();
    if (!entryId) {
      return NextResponse.json({ error: "معرّف الدور مطلوب" }, { status: 400 });
    }

    const clinicId = access.clinicId;
    const admin = getAdminClient();
    const { data: entry, error: fetchErr } = await admin
      .from("patient_queue")
      .select(ENTRY_SELECT)
      .eq("id", entryId)
      .eq("clinic_id", clinicId)
      .maybeSingle();

    if (fetchErr) {
      console.error("[api/queue/screen/call] fetch failed:", fetchErr.message);
      return NextResponse.json(
        { error: "تعذر قراءة الدور — حاول مرة أخرى" },
        { status: 500 }
      );
    }

    if (!entry) {
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
      .eq("clinic_id", clinicId);

    if (updateErr) {
      return NextResponse.json({ error: updateErr.message }, { status: 400 });
    }

    const patientRow = Array.isArray(entry.patient) ? entry.patient[0] : entry.patient;
    const doctorRow = Array.isArray(entry.doctor) ? entry.doctor[0] : entry.doctor;

    const patientName = resolvePatientSpeechName({
      patient: patientRow as {
        full_name_ar: string;
        speech_name_ar?: string | null;
      } | null,
      patient_name: entry.patient_name as string | null,
      ticket_number: entry.ticket_number as number,
    });
    const doctorName = resolveDoctorSpeechName(
      doctorRow as { full_name_ar: string } | null
    );

    void emitQueueScreenCall(entryId, { recall: true }).catch(console.error);
    void emitQueueScreenSync(entryId).catch(console.error);

    return NextResponse.json({
      success: true,
      called_at: now,
      patientName,
      doctorName,
      audioUrl: buildQueueAnnounceAudioUrl(entryId, "queue_screen"),
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
