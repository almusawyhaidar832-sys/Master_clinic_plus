import type { SupabaseClient } from "@supabase/supabase-js";
import { isSalaryDoctor } from "@/lib/services/doctor-payment";
import { recordFinancialTransaction } from "@/lib/services/clinic-profit";

export interface DoctorSalaryPayoutInput {
  clinicId: string;
  doctorId: string;
  amount: number;
  payoutDate: string;
  notes?: string | null;
}

export interface DoctorSalaryPayoutResult {
  referenceId: string;
  descriptionAr: string;
}

/** صرف راتب طبيب — خصم من خزينة العيادة دون ربط بجلسة */
export async function recordDoctorSalaryPayout(
  admin: SupabaseClient,
  input: DoctorSalaryPayoutInput
): Promise<{ ok: true; result: DoctorSalaryPayoutResult } | { ok: false; error: string }> {
  const amount = Math.round(Number(input.amount) * 100) / 100;
  const payoutDate = String(input.payoutDate ?? "").trim();
  const notes = input.notes?.trim() ?? "";

  if (!input.doctorId) {
    return { ok: false, error: "اختر الطبيب" };
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, error: "أدخل مبلغ راتب صالحاً" };
  }
  if (!payoutDate) {
    return { ok: false, error: "تاريخ الصرف مطلوب" };
  }

  const { data: doctor, error: doctorErr } = await admin
    .from("doctors")
    .select("id, full_name_ar, payment_type, clinic_id, is_active")
    .eq("id", input.doctorId)
    .maybeSingle();

  if (doctorErr || !doctor) {
    return { ok: false, error: "الطبيب غير موجود" };
  }
  if (doctor.clinic_id !== input.clinicId) {
    return { ok: false, error: "الطبيب لا ينتمي لهذه العيادة" };
  }
  if (!doctor.is_active) {
    return { ok: false, error: "الطبيب غير نشط" };
  }
  if (!isSalaryDoctor({ payment_type: doctor.payment_type })) {
    return {
      ok: false,
      error: "هذا الطبيب على نظام النسبة — استخدم سحوبات المحفظة بدلاً من صرف الراتب",
    };
  }

  const doctorName = String(doctor.full_name_ar ?? "طبيب").trim();
  const descriptionAr = notes
    ? `راتب طبيب: ${doctorName} — ${notes}`
    : `راتب طبيب: ${doctorName}`;

  // حركة مالية واحدة فقط — مثل «تأكيد صرف» القسيمة؛ لا مصروف منفصل (كان يُخصَم مرتين في اللوحة)
  const referenceId = `${input.doctorId}:${Date.now()}`;

  const txResult = await recordFinancialTransaction(admin, {
    clinicId: input.clinicId,
    amount: -amount,
    type: "doctor_salary_paid",
    descriptionAr,
    transactionDate: payoutDate,
    doctorId: input.doctorId,
    referenceType: "doctor_salary_payout",
    referenceId,
  });

  if (!txResult.ok) {
    return {
      ok: false,
      error: txResult.error ?? "تعذر تسجيل صرف الراتب",
    };
  }

  return {
    ok: true,
    result: { referenceId, descriptionAr },
  };
}
