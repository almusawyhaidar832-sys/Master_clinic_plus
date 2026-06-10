import type { SupabaseClient } from "@supabase/supabase-js";
import { doctorShareFromExpense } from "@/lib/services/assistant-payroll";
import { recordFinancialTransaction } from "@/lib/services/clinic-profit";

export interface DoctorExpenseDeductionInput {
  clinicId: string;
  expenseId: string;
  doctorId: string;
  doctorName: string;
  amount: number;
  percentageSplit: number;
  descriptionAr: string | null;
  expenseDate: string;
}

export interface DoctorExpenseDeductionResult {
  ok: boolean;
  error?: string;
  doctorShare: number;
  clinicShare: number;
  doctorTxSkipped?: boolean;
  clinicTxSkipped?: boolean;
}

/** تطبيق خصم الطبيب والعيادة لفاتورة صرفية (idempotent عبر reference_id) */
export async function applyDoctorExpenseFinancialDeductions(
  admin: SupabaseClient,
  input: DoctorExpenseDeductionInput
): Promise<DoctorExpenseDeductionResult> {
  const doctorShare = doctorShareFromExpense(
    input.amount,
    input.percentageSplit
  );
  const clinicShare = Math.round((input.amount - doctorShare) * 100) / 100;
  const label = input.descriptionAr ?? "صرفية طبيب";

  if (doctorShare > 0) {
    const doctorTx = await recordFinancialTransaction(admin, {
      clinicId: input.clinicId,
      amount: -doctorShare,
      type: "doctor_expense_doctor",
      descriptionAr: `صرفية — ${input.doctorName}: ${label}`,
      transactionDate: input.expenseDate,
      doctorId: input.doctorId,
      referenceType: "doctor_expense_doctor",
      referenceId: input.expenseId,
    });
    if (!doctorTx.ok) {
      return { ok: false, error: doctorTx.error, doctorShare, clinicShare };
    }
  }

  if (clinicShare > 0) {
    const clinicTx = await recordFinancialTransaction(admin, {
      clinicId: input.clinicId,
      amount: -clinicShare,
      type: "doctor_expense_clinic",
      descriptionAr: `حصة عيادة — صرفية ${input.doctorName}: ${label}`,
      transactionDate: input.expenseDate,
      referenceType: "doctor_expense_clinic",
      referenceId: input.expenseId,
    });
    if (!clinicTx.ok) {
      return { ok: false, error: clinicTx.error, doctorShare, clinicShare };
    }
  }

  return { ok: true, doctorShare, clinicShare };
}

/** إلغاء فاتورة لم يُطبَّق عليها خصم بعد */
export async function rollbackDoctorExpenseInsert(
  admin: SupabaseClient,
  expenseId: string
): Promise<void> {
  await admin.from("doctor_expenses").delete().eq("id", expenseId);
}

/** هل طُبِّق خصم الطبيب لهذه الفاتورة؟ */
export async function hasDoctorExpenseDoctorDeduction(
  admin: SupabaseClient,
  clinicId: string,
  expenseId: string
): Promise<boolean> {
  const { data } = await admin
    .from("transactions")
    .select("id")
    .eq("clinic_id", clinicId)
    .eq("reference_type", "doctor_expense_doctor")
    .eq("reference_id", expenseId)
    .maybeSingle();

  return !!data?.id;
}
