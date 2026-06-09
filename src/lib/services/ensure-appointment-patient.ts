import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

export interface AppointmentPatientContext {
  appointmentId: string;
  clinicId: string;
  doctorId: string;
  patientId: string;
  patientName: string;
  patientPhone: string | null;
}

/** يضمن وجود ملف مريض مربوط بالموعد — للانتقال إلى إدخال الجلسة */
export async function ensureAppointmentPatient(
  admin: SupabaseClient,
  appointmentId: string,
  clinicId: string
): Promise<AppointmentPatientContext> {
  const { data: appointment, error } = await admin
    .from("appointments")
    .select(
      "id, clinic_id, doctor_id, patient_id, patient_name_ar, patient_phone"
    )
    .eq("id", appointmentId)
    .eq("clinic_id", clinicId)
    .maybeSingle();

  if (error || !appointment) {
    throw new Error("الموعد غير موجود");
  }

  let patientId = appointment.patient_id as string | null;

  if (!patientId) {
    const name = (appointment.patient_name_ar as string | null)?.trim();
    if (!name) {
      throw new Error("اسم المراجع مطلوب لفتح إدخال الجلسة");
    }

    const { data: newPatient, error: patientErr } = await admin
      .from("patients")
      .insert({
        clinic_id: clinicId,
        full_name_ar: name,
        phone: appointment.patient_phone ?? null,
      })
      .select("id")
      .single();

    if (patientErr || !newPatient) {
      throw new Error(patientErr?.message ?? "تعذر إنشاء ملف المريض");
    }

    patientId = newPatient.id as string;

    await admin
      .from("appointments")
      .update({ patient_id: patientId })
      .eq("id", appointmentId);
  }

  const { data: patient } = await admin
    .from("patients")
    .select("full_name_ar, phone, phone_number")
    .eq("id", patientId)
    .maybeSingle();

  return {
    appointmentId,
    clinicId: appointment.clinic_id as string,
    doctorId: appointment.doctor_id as string,
    patientId,
    patientName:
      (patient?.full_name_ar as string) ||
      (appointment.patient_name_ar as string) ||
      "مراجع",
    patientPhone:
      (patient?.phone as string | null) ??
      (patient?.phone_number as string | null) ??
      (appointment.patient_phone as string | null),
  };
}
