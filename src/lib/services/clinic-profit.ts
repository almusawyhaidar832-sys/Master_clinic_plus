import { randomUUID } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { notifyClinicSync } from "@/lib/sync/clinic-events";
import type { BalanceTopUpTarget } from "@/lib/services/balance-topup";

/** يُبث عند تغيّر المصروفات أو الرواتب — اللوحة التنفيذية تُحدَّث فوراً */
export const CLINIC_PROFIT_REFRESH_EVENT = "clinic-profit-refresh";

export type FinancialTransactionType =
  | "clinic_expense"
  | "staff_salary_accrual"
  | "staff_salary_paid"
  | "doctor_salary_paid"
  | "assistant_payroll_doctor"
  | "assistant_payroll_clinic"
  | "doctor_expense_doctor"
  | "doctor_expense_clinic"
  | "balance_topup_clinic"
  | "balance_topup_doctor";

export interface RecordTransactionInput {
  clinicId: string;
  amount: number;
  type: FinancialTransactionType;
  descriptionAr: string;
  transactionDate: string;
  doctorId?: string | null;
  patientId?: string | null;
  operationId?: string | null;
  referenceType?: string | null;
  referenceId?: string | null;
}

/** إشعار الواجهة بتحديث صافي الربح */
export function notifyClinicProfitRefresh(clinicId?: string): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(CLINIC_PROFIT_REFRESH_EVENT));
    notifyClinicSync({
      topic: ["profit", "financial"],
      clinicId,
      source: "mutation",
    });
  }
}

/** إشعار فوري بعد شحن رصيد — يحدّث محفظة الطبيب والكشف المالي */
export function notifyBalanceTopUpRefresh(options: {
  clinicId?: string;
  doctorId?: string | null;
  target: BalanceTopUpTarget;
}): void {
  if (typeof window === "undefined") return;

  if (options.target === "clinic") {
    notifyClinicSync({
      topic: ["profit", "financial", "audit"],
      clinicId: options.clinicId,
      source: "mutation",
      force: true,
    });
    return;
  }

  if (options.target === "doctor" && options.doctorId) {
    notifyClinicSync({
      topic: ["financial", "profit"],
      clinicId: options.clinicId,
      doctorId: options.doctorId,
      source: "mutation",
      force: true,
    });
  }
}

/**
 * تسجيل حركة مالية + إشعار تحديث الربح (من الخادم أو العميل بعد نجاح API).
 */
export async function updateClinicProfit(
  admin: SupabaseClient,
  input: RecordTransactionInput
): Promise<{ ok: boolean; error?: string }> {
  const result = await recordFinancialTransaction(admin, input);
  return result;
}

/** إدراج حركة — idempotent عند تكرار reference */
export async function recordFinancialTransaction(
  admin: SupabaseClient,
  input: RecordTransactionInput
): Promise<{ ok: boolean; error?: string; skipped?: boolean }> {
  if (input.referenceType && input.referenceId) {
    const { data: existing } = await admin
      .from("transactions")
      .select("id")
      .eq("clinic_id", input.clinicId)
      .eq("reference_type", input.referenceType)
      .eq("reference_id", input.referenceId)
      .maybeSingle();

    if (existing?.id) {
      return { ok: true, skipped: true };
    }
  }

  const { error } = await admin.from("transactions").insert({
    id: randomUUID(),
    clinic_id: input.clinicId,
    doctor_id: input.doctorId ?? null,
    patient_id: input.patientId ?? null,
    operation_id: input.operationId ?? null,
    amount: input.amount,
    type: input.type,
    description_ar: input.descriptionAr,
    transaction_date: input.transactionDate,
    reference_type: input.referenceType ?? null,
    reference_id: input.referenceId ?? null,
  });

  if (error) {
    // 23505 = unique_violation — طلبان متزامنان مرّا كلاهما من فحص الوجود
    // أعلاه (TOCTOU)؛ قيد التفرّد بقاعدة البيانات
    // (transactions_clinic_reference_unique) يوقف التكرار الفعلي، ونتعامل
    // معه هنا كنجاح "متجاوَز" بدل خطأ — نفس سلوك الفحص المسبق تماماً.
    if (error.code === "23505") {
      return { ok: true, skipped: true };
    }
    return { ok: false, error: error.message };
  }

  return { ok: true };
}

/** حذف حركات مالية مرتبطة بمرجع (مثل إلغاء تأكيد الصرف) */
export async function deleteFinancialTransactionsByReference(
  admin: SupabaseClient,
  clinicId: string,
  referenceType: string,
  referenceId: string
): Promise<{ ok: boolean; deleted: number; error?: string }> {
  const { data: rows, error: fetchErr } = await admin
    .from("transactions")
    .select("id")
    .eq("clinic_id", clinicId)
    .eq("reference_type", referenceType)
    .eq("reference_id", referenceId);

  if (fetchErr) {
    return { ok: false, deleted: 0, error: fetchErr.message };
  }

  const ids = (rows ?? []).map((r) => r.id as string);
  if (ids.length === 0) {
    return { ok: true, deleted: 0 };
  }

  const { error: delErr } = await admin.from("transactions").delete().in("id", ids);
  if (delErr) {
    return { ok: false, deleted: 0, error: delErr.message };
  }

  return { ok: true, deleted: ids.length };
}
