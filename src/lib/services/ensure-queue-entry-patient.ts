import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  patientPhoneColumns,
  validatePatientPhone,
} from "@/lib/phone";
import { ensureAppointmentPatient } from "@/lib/services/ensure-appointment-patient";

export interface QueueEntryPatientContext {
  queueEntryId: string;
  clinicId: string;
  doctorId: string;
  patientId: string;
  patientName: string;
  patientPhone: string | null;
  appointmentId: string | null;
}

async function findPatientIdByPhone(
  admin: SupabaseClient,
  clinicId: string,
  phone: string
): Promise<string | null> {
  const digits = phone.replace(/\D/g, "");
  if (!digits) return null;

  const { data } = await admin
    .from("patients")
    .select("id")
    .eq("clinic_id", clinicId)
    .or(`phone.ilike.%${digits}%,phone_number.ilike.%${digits}%`)
    .limit(1)
    .maybeSingle();

  return (data?.id as string | undefined) ?? null;
}

async function findPatientIdByName(
  admin: SupabaseClient,
  clinicId: string,
  name: string
): Promise<string | null> {
  const trimmed = name.trim();
  if (!trimmed) return null;

  const { data } = await admin
    .from("patients")
    .select("id")
    .eq("clinic_id", clinicId)
    .eq("full_name_ar", trimmed)
    .limit(1)
    .maybeSingle();

  return (data?.id as string | undefined) ?? null;
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

  if (!patientId && queuePhone) {
    patientId = await findPatientIdByPhone(admin, clinicId, queuePhone);
  }

  if (!patientId && queueName) {
    patientId = await findPatientIdByName(admin, clinicId, queueName);
  }

  if (!patientId) {
    const name = queueName || (queuePhone ? "مراجع" : "");
    if (!name) {
      throw new Error(
        "أدخل اسم المراجع أو رقم هاتفه عند الإضافة للطابور لربط ملف المريض"
      );
    }

    const phoneCheck = queuePhone ? validatePatientPhone(queuePhone) : null;
    const insertPayload: Record<string, unknown> = {
      clinic_id: clinicId,
      full_name_ar: name,
      primary_doctor_id: entry.doctor_id,
    };

    if (phoneCheck?.ok) {
      Object.assign(insertPayload, patientPhoneColumns(phoneCheck.normalized));
    } else if (queuePhone) {
      insertPayload.phone = queuePhone;
    }

    const { data: newPatient, error: patientErr } = await admin
      .from("patients")
      .insert(insertPayload)
      .select("id")
      .single();

    if (patientErr || !newPatient) {
      throw new Error(patientErr?.message ?? "تعذر إنشاء ملف المريض");
    }

    patientId = newPatient.id as string;
  }

  if (!entry.patient_id) {
    await admin
      .from("patient_queue")
      .update({ patient_id: patientId })
      .eq("id", queueEntryId)
      .eq("clinic_id", clinicId);
  }

  const { data: patient } = await admin
    .from("patients")
    .select("full_name_ar, phone, phone_number")
    .eq("id", patientId)
    .maybeSingle();

  return {
    queueEntryId,
    clinicId,
    doctorId: entry.doctor_id as string,
    patientId,
    patientName:
      (patient?.full_name_ar as string) || queueName || "مراجع",
    patientPhone:
      (patient?.phone as string | null) ??
      (patient?.phone_number as string | null) ??
      (queuePhone || null),
    appointmentId,
  };
}
