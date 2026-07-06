import type { SupabaseClient } from "@supabase/supabase-js";
import { getPatientDisplayPhone } from "@/lib/phone";
import {
  ensurePatientIdForBooking,
  findPatientIdByName,
  resolveExistingPatientId,
} from "@/lib/services/resolve-patient-id";

/** مسار ملف المريض من الموعد — بحث بالهاتف ثم إنشاء/ربط عند الحاجة */
export async function resolveAppointmentPatientProfileHref(
  supabase: SupabaseClient,
  clinicId: string,
  appointment: {
    id: string;
    patient_id: string | null;
    patient_phone: string | null;
    patient_name_ar: string | null;
  }
): Promise<string> {
  if (appointment.patient_id) {
    return `/dashboard/patients/${appointment.patient_id}`;
  }

  const name = appointment.patient_name_ar?.trim();
  if (name) {
    const byName = await findPatientIdByName(supabase, clinicId, name);
    if (byName) return `/dashboard/patients/${byName}`;
  }

  const ctx = await ensureAppointmentPatientClient(
    supabase,
    appointment.id,
    clinicId
  );
  return `/dashboard/patients/${ctx.patientId}`;
}

export interface ClientAppointmentPatientContext {
  patientId: string;
  patientName: string;
  patientPhone: string | null;
  doctorId: string;
  doctorName?: string;
}

/** إنشاء/ربط ملف المريض من الموعد — بدون fetch لـ API (يتجنب Failed to fetch) */
export async function ensureAppointmentPatientClient(
  supabase: SupabaseClient,
  appointmentId: string,
  clinicId: string
): Promise<ClientAppointmentPatientContext> {
  const { data: appt, error } = await supabase
    .from("appointments")
    .select(
      `id, patient_id, patient_name_ar, patient_phone, doctor_id,
       doctor:doctors(full_name_ar)`
    )
    .eq("id", appointmentId)
    .eq("clinic_id", clinicId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!appt) throw new Error("الموعد غير موجود");

  let patientId = appt.patient_id as string | null;
  const doctor = appt.doctor as { full_name_ar?: string } | null;

  if (!patientId) {
    const name = (appt.patient_name_ar as string | null)?.trim();
    if (!name) throw new Error("اسم المراجع مطلوب لفتح إدخال الجلسة");

    patientId = await resolveExistingPatientId(supabase, clinicId, {
      name,
      phone: (appt.patient_phone as string | null) ?? null,
    });

    if (!patientId) {
      patientId = await ensurePatientIdForBooking(supabase, clinicId, {
        name,
        phone: (appt.patient_phone as string | null) ?? null,
        primaryDoctorId: appt.doctor_id as string,
      });
    }

    await supabase
      .from("appointments")
      .update({ patient_id: patientId })
      .eq("id", appointmentId);
  }

  const { data: patient } = await supabase
    .from("patients")
    .select("full_name_ar, phone, phone_number")
    .eq("id", patientId)
    .maybeSingle();

  return {
    patientId,
    patientName:
      (patient?.full_name_ar as string) ||
      (appt.patient_name_ar as string) ||
      "مراجع",
    patientPhone:
      getPatientDisplayPhone(patient ?? {}) ??
      (appt.patient_phone as string | null),
    doctorId: appt.doctor_id as string,
    doctorName: doctor?.full_name_ar,
  };
}
