import type { SupabaseClient } from "@supabase/supabase-js";
import {
  recordFinancialTransaction,
  type RecordTransactionInput,
} from "@/lib/services/clinic-profit";
import type { PayrollRecord } from "@/types";
import type { SalarySlip } from "@/types";

function monthLastDay(monthYear: string): string {
  const [y, m] = monthYear.split("-").map(Number);
  const last = new Date(y, m, 0).getDate();
  return `${y}-${String(m).padStart(2, "0")}-${String(last).padStart(2, "0")}`;
}

/** حركات مالية بعد توليد رواتب الشهر */
export async function recordPayrollGenerateTransactions(
  admin: SupabaseClient,
  clinicId: string,
  monthYear: string,
  records: PayrollRecord[],
  slips: Pick<
    SalarySlip,
    "id" | "staff_id" | "net_payout" | "month_year"
  >[]
): Promise<{ created: number; errors: string[] }> {
  const txDate = monthLastDay(monthYear);
  const errors: string[] = [];
  let created = 0;

  for (const r of records) {
    const clinicAmt = -Number(r.clinic_share_amount ?? 0);
    if (clinicAmt < 0) {
      const clinicTx: RecordTransactionInput = {
        clinicId,
        amount: clinicAmt,
        type: "assistant_payroll_clinic",
        descriptionAr: `حصة عيادة — مساعد ${r.assistant_name_ar} — ${monthYear}`,
        transactionDate: txDate,
        referenceType: "payroll_record_clinic",
        referenceId: r.id,
      };
      const res = await recordFinancialTransaction(admin, clinicTx);
      if (!res.ok && res.error) errors.push(res.error);
      else if (!res.skipped) created++;
    }
  }

  for (const slip of slips) {
    const amt = -Number(slip.net_payout ?? 0);
    if (amt >= 0) continue;
    const tx: RecordTransactionInput = {
      clinicId,
      amount: amt,
      type: "staff_salary_accrual",
      descriptionAr: `راتب موظف — ${monthYear}`,
      transactionDate: txDate,
      referenceType: "salary_slip_accrual",
      referenceId: slip.id,
    };
    const res = await recordFinancialTransaction(admin, tx);
    if (!res.ok && res.error) errors.push(res.error);
    else if (!res.skipped) created++;
  }

  return { created, errors };
}

/** تأكيد صرف قسيمة طبيب راتب ثابت */
export async function recordDoctorSalarySlipPaidTransaction(
  admin: SupabaseClient,
  clinicId: string,
  slip: Pick<SalarySlip, "id" | "net_payout" | "month_year" | "doctor_id">
): Promise<{ ok: boolean; error?: string }> {
  const amt = -Number(slip.net_payout ?? 0);
  if (amt >= 0) return { ok: true };
  const doctorId = slip.doctor_id?.trim();
  if (!doctorId) {
    return { ok: false, error: "قسيمة الطبيب بدون معرّف" };
  }

  return recordFinancialTransaction(admin, {
    clinicId,
    amount: amt,
    type: "doctor_salary_paid",
    descriptionAr: `صرف راتب طبيب — ${slip.month_year}`,
    transactionDate: new Date().toISOString().slice(0, 10),
    doctorId,
    referenceType: "salary_slip_doctor_paid",
    referenceId: slip.id,
  });
}

/** تأكيد صرف قسيمة موظف */
export async function recordStaffSlipPaidTransaction(
  admin: SupabaseClient,
  clinicId: string,
  slip: Pick<SalarySlip, "id" | "net_payout" | "month_year">
): Promise<{ ok: boolean; error?: string }> {
  const amt = -Number(slip.net_payout ?? 0);
  if (amt >= 0) return { ok: true };

  return recordFinancialTransaction(admin, {
    clinicId,
    amount: amt,
    type: "staff_salary_paid",
    descriptionAr: `صرف راتب موظف — ${slip.month_year}`,
    transactionDate: new Date().toISOString().slice(0, 10),
    referenceType: "salary_slip_paid",
    referenceId: slip.id,
  });
}

/** تأكيد صرف راتب مساعد — خصم من الطبيب */
export async function recordAssistantPayrollPaidTransaction(
  admin: SupabaseClient,
  clinicId: string,
  record: PayrollRecord
): Promise<{ ok: boolean; error?: string }> {
  const amt = -Number(record.doctor_share_amount ?? 0);
  if (amt >= 0) return { ok: true };

  return recordFinancialTransaction(admin, {
    clinicId,
    amount: amt,
    type: "assistant_payroll_doctor",
    descriptionAr: `صرف راتب مساعد ${record.assistant_name_ar} — ${record.month_year}`,
    transactionDate: new Date().toISOString().slice(0, 10),
    doctorId: record.doctor_id,
    referenceType: "payroll_record_paid",
    referenceId: record.id,
  });
}
