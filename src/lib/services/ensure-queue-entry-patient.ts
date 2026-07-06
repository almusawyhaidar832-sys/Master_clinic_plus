import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { ensureAppointmentPatient } from "@/lib/services/ensure-appointment-patient";
import { ensurePatientProfileForBooking } from "@/lib/services/resolve-patient-id";

export interface QueueEntryPatientContext {
  queueEntryId: string;
  clinicId: string;
  doctorId: string;
  patientId: string;
  patientName: string;
  patientPhone: string | null;
  appointmentId: string | null;
}

/** يضمن وجود ملف مريض مربوط بدور الطابور — للسجل البصري والفوترة */
export async function ensureQueueEntryPatient(
  admin: SupabaseClient,
  queueEntryId: string,
  clinicId: string
): Promise<QueueEntryPatientContext> {
  const { data: entry, error } = await admin
    .from("patient_queue")
    .select(
      "id, clinic_id, doctor_id, patient_id, patient_name, patient_phone, appointment_id"
    )
    .eq("id", queueEntryId)
    .eq("clinic_id", clinicId)
    .maybeSingle();

  if (error || !entry?.doctor_id) {
    throw new Error("الدور غير موجود في الطابور");
  }

  let patientId = entry.patient_id as string | null;
  const appointmentId = (entry.appointment_id as string | null) ?? null;

  if (!patientId && appointmentId) {
    const apptCtx = await ensureAppointmentPatient(
      admin,
      appointmentId,
      clinicId
    );
    patientId = apptCtx.patientId;
  }

  const queuePhone = (entry.patient_phone as string | null)?.trim() ?? "";
  const queueName = (entry.patient_name as string | null)?.trim() ?? "";

  let resolvedName = queueName || "مراجع";
  let resolvedPhone = queuePhone || null;

  if (!patientId) {
    const name = queueName || (queuePhone ? "مراجع" : "");
    if (!name) {
      throw new Error(
        "أدخل اسم المراجع أو رقم هاتفه عند الإضافة للطابور لربط ملف المريض"
      );
    }

    const profile = await ensurePatientProfileForBooking(admin, clinicId, {
      name,
      phone: queuePhone || null,
      primaryDoctorId: entry.doctor_id as string,
    });
    patientId = profile.patientId;
    resolvedName = profile.name;
    resolvedPhone = profile.phone ?? (queuePhone || null);
  } else {
    const { data: patient } = await admin
      .from("patients")
      .select("full_name_ar, phone, phone_number")
      .eq("id", patientId)
      .maybeSingle();

    resolvedName =
      (patient?.full_name_ar as string)?.trim() || queueName || "مراجع";
    resolvedPhone =
      (patient?.phone as string | null) ??
      (patient?.phone_number as string | null) ??
      (queuePhone || null);
  }

  const queuePatch: Record<string, unknown> = {
    patient_id: patientId,
    patient_name: resolvedName,
  };
  if (resolvedPhone) {
    queuePatch.patient_phone = resolvedPhone;
  }

  if (
    entry.patient_id !== patientId ||
    entry.patient_name !== resolvedName ||
    (resolvedPhone && entry.patient_phone !== resolvedPhone)
  ) {
    await admin
      .from("patient_queue")
      .update(queuePatch)
      .eq("id", queueEntryId)
      .eq("clinic_id", clinicId);
  }

  return {
    queueEntryId,
    clinicId,
    doctorId: entry.doctor_id as string,
    patientId,
    patientName: resolvedName,
    patientPhone: resolvedPhone,
    appointmentId,
  };
}
