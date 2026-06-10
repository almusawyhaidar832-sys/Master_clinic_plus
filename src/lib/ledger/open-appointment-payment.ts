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

  if (input.appointmentId) {
    const supabase = createClient();
    const ctx = await ensureAppointmentPatientClient(
      supabase,
      input.appointmentId,
      input.clinicId
    );
    patientId = ctx.patientId;
    doctorId = doctorId ?? ctx.doctorId;
  }

  if (!patientId && input.patientPhone?.trim()) {
    const supabase = createClient();
    const digits = input.patientPhone.replace(/\D/g, "");
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

  if (!patientId && !input.appointmentId) {
    throw new Error("لا يوجد ملف مريض — سجّل الدخول أولاً أو اربط الموعد بمريض");
  }

  return buildLedgerPayUrl({
    patientId,
    appointmentId: input.appointmentId ?? null,
    queueEntryId: input.queueEntryId ?? null,
    doctorId,
  });
}
