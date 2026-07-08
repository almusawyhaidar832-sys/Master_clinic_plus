import type { SupabaseClient } from "@supabase/supabase-js";
import { breakdownAssistantSalary } from "@/lib/services/assistant-payroll";
import type { PayrollRecord, SalarySlip } from "@/types";

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

export type PayrollPendingMode = {
  dailyWage?: boolean;
  /** عند التوفّر: يُحسب المتبقي من النسبة الحالية وليس من doctor_share_amount المخزّن */
  doctorSharePercentage?: number;
};

type AssistantShareRecord = Pick<
  PayrollRecord,
  | "total_salary"
  | "doctor_share_amount"
  | "paid_doctor_share_amount"
  | "clinic_share_amount"
  | "paid_clinic_share_amount"
>;

/** حصتا الطبيب/العيادة المستحقّتان من total_salary حسب النسبة */
export function assistantAccruedShares(
  record: Pick<PayrollRecord, "total_salary"> | null | undefined,
  doctorSharePercentage: number
): { doctor: number; clinic: number } {
  if (!record) return { doctor: 0, clinic: 0 };
  const breakdown = breakdownAssistantSalary({
    total_salary: Number(record.total_salary ?? 0),
    doctor_share_percentage: doctorSharePercentage,
  });
  return {
    doctor: breakdown.doctorShare,
    clinic: breakdown.clinicShare,
  };
}

/** المتبقي غير المؤكَّد — يُفضَّل تمرير doctorSharePercentage من جدول assistants */
export function assistantPendingShares(
  record: AssistantShareRecord | null | undefined,
  doctorSharePercentage: number
): { doctor: number; clinic: number } {
  if (!record) return { doctor: 0, clinic: 0 };
  const accrued = assistantAccruedShares(record, doctorSharePercentage);
  return {
    doctor: roundMoney(
      Math.max(0, accrued.doctor - assistantPaidDoctorShare(record))
    ),
    clinic: roundMoney(
      Math.max(0, accrued.clinic - assistantPaidClinicShare(record))
    ),
  };
}

export function slipPaidNet(
  slip: Pick<SalarySlip, "paid_net_payout"> | null | undefined
): number {
  return roundMoney(Number(slip?.paid_net_payout ?? 0));
}

/** المبلغ المتبقي غير المؤكَّد — أجر يومي: net_payout = المتبقي فقط */
export function slipPendingNet(
  slip: Pick<SalarySlip, "net_payout" | "paid_net_payout"> | null | undefined,
  mode?: PayrollPendingMode
): number {
  if (!slip) return 0;
  const net = roundMoney(Number(slip.net_payout ?? 0));
  if (mode?.dailyWage) return net;
  return roundMoney(Math.max(0, net - slipPaidNet(slip)));
}

export function slipIsFullyPaid(
  slip: Pick<SalarySlip, "net_payout" | "paid_net_payout" | "status"> | null,
  mode?: PayrollPendingMode
): boolean {
  if (!slip) return false;
  return slipPendingNet(slip, mode) <= 0 && slipPaidNet(slip) > 0;
}

/** صافي غير مؤكَّد من مجموع الحركات − المؤكَّد سابقاً */
export function dailyWagePendingFromAccrued(
  accruedNet: number,
  paidNet: number
): number {
  return roundMoney(Math.max(0, accruedNet - paidNet));
}

export function assistantPaidDoctorShare(
  record: Pick<PayrollRecord, "paid_doctor_share_amount"> | null | undefined
): number {
  return roundMoney(Number(record?.paid_doctor_share_amount ?? 0));
}

export function assistantPaidClinicShare(
  record: Pick<PayrollRecord, "paid_clinic_share_amount"> | null | undefined
): number {
  return roundMoney(Number(record?.paid_clinic_share_amount ?? 0));
}

export function assistantPaidTotalSalary(
  record: Pick<PayrollRecord, "paid_total_salary"> | null | undefined
): number {
  return roundMoney(Number(record?.paid_total_salary ?? 0));
}

export function assistantPendingDoctorShare(
  record: AssistantShareRecord | null,
  mode?: PayrollPendingMode
): number {
  if (!record) return 0;
  if (mode?.doctorSharePercentage != null) {
    return assistantPendingShares(record, mode.doctorSharePercentage).doctor;
  }
  if (mode?.dailyWage) {
    return roundMoney(Number(record.doctor_share_amount ?? 0));
  }
  return roundMoney(
    Math.max(
      0,
      Number(record.doctor_share_amount ?? 0) - assistantPaidDoctorShare(record)
    )
  );
}

export function assistantPendingClinicShare(
  record: AssistantShareRecord | null,
  mode?: PayrollPendingMode
): number {
  if (!record) return 0;
  if (mode?.doctorSharePercentage != null) {
    return assistantPendingShares(record, mode.doctorSharePercentage).clinic;
  }
  if (mode?.dailyWage) {
    return roundMoney(Number(record.clinic_share_amount ?? 0));
  }
  return roundMoney(
    Math.max(
      0,
      Number(record.clinic_share_amount ?? 0) - assistantPaidClinicShare(record)
    )
  );
}

export function assistantPendingTotalSalary(
  record: Pick<PayrollRecord, "total_salary" | "paid_total_salary"> | null,
  mode?: PayrollPendingMode
): number {
  if (!record) return 0;
  if (mode?.dailyWage) {
    return roundMoney(Number(record.total_salary ?? 0));
  }
  return roundMoney(
    Math.max(
      0,
      Number(record.total_salary ?? 0) - assistantPaidTotalSalary(record)
    )
  );
}

export function assistantIsFullyPaid(
  record: Pick<
    PayrollRecord,
    | "total_salary"
    | "doctor_share_amount"
    | "clinic_share_amount"
    | "paid_total_salary"
    | "paid_doctor_share_amount"
    | "paid_clinic_share_amount"
    | "status"
  > | null,
  mode?: PayrollPendingMode
): boolean {
  if (!record) return false;
  if (mode?.dailyWage) {
    return (
      assistantPendingTotalSalary(record, mode) <= 0 &&
      assistantPaidTotalSalary(record) > 0
    );
  }
  return (
    assistantPendingTotalSalary(record) <= 0 &&
    assistantPendingDoctorShare(record) <= 0 &&
    assistantPendingClinicShare(record) <= 0 &&
    assistantPaidTotalSalary(record) > 0
  );
}

const PAYROLL_DEDUCTION_TYPES = [
  "staff_salary_paid",
  "assistant_payroll_clinic",
  "doctor_salary_paid",
] as const;

export const CONFIRMED_PAYROLL_TYPE_LABELS: Record<string, string> = {
  staff_salary_paid: "صرف موظف",
  assistant_payroll_clinic: "حصة عيادة — مساعد",
  doctor_salary_paid: "صرف راتب طبيب",
};

export interface ConfirmedPayrollPayoutLine {
  id: string;
  type: string;
  typeLabel: string;
  amount: number;
  transactionDate: string;
  descriptionAr: string;
  referenceId?: string;
}

/** خصم من الربح: سالب = صرف، موجب = تصحيح/استرداد */
export function payrollProfitDeductionFromTransactionAmount(
  amount: number
): number {
  const amt = Number(amount);
  if (amt < 0) return roundMoney(Math.abs(amt));
  if (amt > 0) return roundMoney(-amt);
  return 0;
}

/** حركات صرف مؤكَّدة ضمن الفترة — transaction_date (تقويم محلي عند التأكيد) */
export async function fetchConfirmedPayrollProfitDeduction(
  supabase: SupabaseClient,
  clinicId: string,
  from: string,
  to: string
): Promise<number> {
  const { data, error } = await supabase
    .from("transactions")
    .select("amount")
    .eq("clinic_id", clinicId)
    .gte("transaction_date", from)
    .lte("transaction_date", to)
    .in("type", [...PAYROLL_DEDUCTION_TYPES]);

  if (error || !data?.length) return 0;

  return roundMoney(
    data.reduce(
      (sum, row) =>
        sum +
        payrollProfitDeductionFromTransactionAmount(Number(row.amount ?? 0)),
      0
    )
  );
}

/** تفاصيل صرف الرواتب المؤكَّد — للتقارير */
export async function fetchConfirmedPayrollPayoutLines(
  supabase: SupabaseClient,
  clinicId: string,
  from: string,
  to: string
): Promise<ConfirmedPayrollPayoutLine[]> {
  const { data, error } = await supabase
    .from("transactions")
    .select("id, amount, type, transaction_date, description_ar, reference_id")
    .eq("clinic_id", clinicId)
    .gte("transaction_date", from)
    .lte("transaction_date", to)
    .in("type", [...PAYROLL_DEDUCTION_TYPES])
    .order("transaction_date", { ascending: false });

  if (error || !data?.length) return [];

  const lines: ConfirmedPayrollPayoutLine[] = [];

  for (const row of data ?? []) {
    const amt = Number(row.amount ?? 0);
    if (amt === 0) continue;
    const type = String(row.type ?? "");
    const netDeduction = payrollProfitDeductionFromTransactionAmount(amt);
    if (netDeduction === 0) continue;
    const isCredit = amt > 0;
    lines.push({
      id: row.id as string,
      type,
      typeLabel: isCredit
        ? `${CONFIRMED_PAYROLL_TYPE_LABELS[type] ?? type} — تصحيح`
        : (CONFIRMED_PAYROLL_TYPE_LABELS[type] ?? type),
      amount: netDeduction,
      transactionDate: String(row.transaction_date ?? ""),
      descriptionAr: String(row.description_ar ?? "").trim(),
      referenceId: row.reference_id ? String(row.reference_id) : undefined,
    });
  }

  return lines;
}

