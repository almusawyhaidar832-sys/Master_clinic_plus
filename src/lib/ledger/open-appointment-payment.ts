"use client";

import { createClient } from "@/lib/supabase/client";
import { ensureAppointmentPatientClient } from "@/lib/services/ensure-appointment-patient-client";
import { buildLedgerPayUrl } from "@/lib/ledger/navigation";

export interface OpenAppointmentPaymentInput {
  clinicId: string;
  appointmentId?: string | null;
  queueEntryId?: string | null;
  patientId?: string | null;
  doctorId?: string | null;
  patientPhone?: string | null;
  patientNameAr?: string | null;
}

/**
 * فتح صفحة إدخال الجلسة للدفع — مع تقسيم الطبيب/العيادة في QuickEntryForm.
 * يستخدم Supabase مباشرة لتجنب Failed to fetch من API وسيط.
 */
export async function resolveAppointmentPaymentUrl(
  input: OpenAppointmentPaymentInput
): Promise<string> {
  let patientId = input.patientId ?? null;
  let doctorId = input.doctorId ?? null;
  let patientPhone = input.patientPhone ?? null;

  const supabase = createClient();

  if (input.appointmentId) {
    const ctx = await ensureAppointmentPatientClient(
      supabase,
      input.appointmentId,
      input.clinicId
    );
    patientId = ctx.patientId;
    doctorId = doctorId ?? ctx.doctorId;
  }

  if (!patientId && input.queueEntryId) {
    const { data: queueEntry } = await supabase
      .from("patient_queue")
      .select("patient_id, doctor_id, patient_phone, appointment_id")
      .eq("id", input.queueEntryId)
      .eq("clinic_id", input.clinicId)
      .maybeSingle();

    patientId = (queueEntry?.patient_id as string | null) ?? patientId;
    doctorId = doctorId ?? (queueEntry?.doctor_id as string | undefined) ?? null;

    if (!patientId && queueEntry?.appointment_id) {
      const ctx = await ensureAppointmentPatientClient(
        supabase,
        queueEntry.appointment_id as string,
        input.clinicId
      );
      patientId = ctx.patientId;
      doctorId = doctorId ?? ctx.doctorId;
    }

    if (!patientId && !patientPhone?.trim() && queueEntry?.patient_phone) {
      patientPhone = queueEntry.patient_phone as string;
    }
  }

  if (!patientId && patientPhone?.trim()) {
    const digits = patientPhone.replace(/\D/g, "");
    if (digits) {
      const { data } = await supabase
        .from("patients")
        .select("id")
        .eq("clinic_id", input.clinicId)
        .or(`phone.ilike.%${digits}%,phone_number.ilike.%${digits}%`)
        .limit(1)
        .maybeSingle();
      patientId = (data?.id as string | undefined) ?? null;
    }
  }

  if (!patientId && !input.appointmentId && !input.queueEntryId) {
    throw new Error("لا يوجد ملف مريض — سجّل الدخول أولاً أو اربط الموعد بمريض");
  }

  return buildLedgerPayUrl({
    patientId,
    appointmentId: input.appointmentId ?? null,
    queueEntryId: input.queueEntryId ?? null,
    doctorId,
    patientName: input.patientNameAr ?? null,
    patientPhone,
  });
}
