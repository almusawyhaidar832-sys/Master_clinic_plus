import type { SupabaseClient } from "@supabase/supabase-js";
import type { PayrollRecord, SalarySlip } from "@/types";

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

export type PayrollPendingMode = { dailyWage?: boolean };

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
  record: Pick<
    PayrollRecord,
    "doctor_share_amount" | "paid_doctor_share_amount"
  > | null,
  mode?: PayrollPendingMode
): number {
  if (!record) return 0;
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
  record: Pick<
    PayrollRecord,
    "clinic_share_amount" | "paid_clinic_share_amount"
  > | null,
  mode?: PayrollPendingMode
): number {
  if (!record) return 0;
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

/** حركات صرف مؤكَّدة ضمن الفترة — مصدر خصم الربح في اللوحة التنفيذية */
export async function fetchConfirmedPayrollProfitDeduction(
  supabase: SupabaseClient,
  clinicId: string,
  from: string,
  to: string
): Promise<number> {
  const { data, error } = await supabase
    .from("transactions")
    .select("amount, type")
    .eq("clinic_id", clinicId)
    .gte("transaction_date", from)
    .lte("transaction_date", to)
    .in("type", [
      "staff_salary_paid",
      "assistant_payroll_clinic",
      "doctor_salary_paid",
    ]);

  if (error || !data?.length) return 0;

  return roundMoney(
    data.reduce((sum, row) => {
      const amt = Number(row.amount ?? 0);
      return amt < 0 ? sum + Math.abs(amt) : sum;
    }, 0)
  );
}
