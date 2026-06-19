import type { SupabaseClient } from "@supabase/supabase-js";
import {
  deleteFinancialTransactionsByReference,
  recordFinancialTransaction,
} from "@/lib/services/clinic-profit";
import type { PayrollRecord } from "@/types";
import type { SalarySlip } from "@/types";

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

function confirmReference(parentId: string): string {
  return `${parentId}:${Date.now()}`;
}

async function listPayrollConfirmTransactions(
  admin: SupabaseClient,
  clinicId: string,
  referenceType: string,
  parentId: string
) {
  const { data, error } = await admin
    .from("transactions")
    .select("id, amount, reference_id, transaction_date")
    .eq("clinic_id", clinicId)
    .eq("reference_type", referenceType)
    .like("reference_id", `${parentId}:%`);

  if (error) {
    return {
      rows: [] as {
        id: string;
        amount: number;
        reference_id: string;
        transaction_date: string;
      }[],
      error: error.message,
    };
  }

  const legacy = await admin
    .from("transactions")
    .select("id, amount, reference_id, transaction_date")
    .eq("clinic_id", clinicId)
    .eq("reference_type", referenceType)
    .eq("reference_id", parentId);

  const rows = [
    ...(data ?? []),
    ...(legacy.data ?? []).filter((r) => !String(r.reference_id).includes(":")),
  ];
  rows.sort((a, b) =>
    String(a.reference_id).localeCompare(String(b.reference_id))
  );
  return { rows, error: undefined };
}

/** توليد رواتب الشهر — لا يخصم من الربح (الخصم عند «تأكيد الصرف» فقط) */
export async function recordPayrollGenerateTransactions(
  _admin: SupabaseClient,
  _clinicId: string,
  _monthYear: string,
  _records: PayrollRecord[],
  _slips: Pick<SalarySlip, "id" | "staff_id" | "net_payout" | "month_year">[]
): Promise<{ created: number; errors: string[] }> {
  return { created: 0, errors: [] };
}

/** تأكيد صرف قسيمة طبيب راتب ثابت — المبلغ المتبقي فقط */
export async function recordDoctorSalarySlipPaidTransaction(
  admin: SupabaseClient,
  clinicId: string,
  slip: Pick<
    SalarySlip,
    "id" | "net_payout" | "month_year" | "doctor_id" | "paid_net_payout"
  >,
  delta?: number
): Promise<{ ok: boolean; error?: string; amount?: number }> {
  const paid = roundMoney(Number(slip.paid_net_payout ?? 0));
  const pending = roundMoney(
    delta ?? Math.max(0, Number(slip.net_payout ?? 0) - paid)
  );
  if (pending <= 0) return { ok: true, amount: 0 };

  const doctorId = slip.doctor_id?.trim();
  if (!doctorId) {
    return { ok: false, error: "قسيمة الطبيب بدون معرّف" };
  }

  const res = await recordFinancialTransaction(admin, {
    clinicId,
    amount: -pending,
    type: "doctor_salary_paid",
    descriptionAr: `صرف راتب طبيب — ${slip.month_year}`,
    transactionDate: new Date().toISOString().slice(0, 10),
    doctorId,
    referenceType: "salary_slip_doctor_paid",
    referenceId: confirmReference(slip.id),
  });
  return res.ok
    ? { ok: true, amount: pending }
    : { ok: false, error: res.error };
}

/** تأكيد صرف قسيمة موظف — المبلغ المتبقي فقط */
export async function recordStaffSlipPaidTransaction(
  admin: SupabaseClient,
  clinicId: string,
  slip: Pick<SalarySlip, "id" | "net_payout" | "month_year" | "paid_net_payout">,
  delta?: number,
  dailyWage?: boolean
): Promise<{ ok: boolean; error?: string; amount?: number }> {
  const paid = roundMoney(Number(slip.paid_net_payout ?? 0));
  const pending = roundMoney(
    delta ??
      (dailyWage
        ? Number(slip.net_payout ?? 0)
        : Math.max(0, Number(slip.net_payout ?? 0) - paid))
  );
  if (pending <= 0) return { ok: true, amount: 0 };

  const res = await recordFinancialTransaction(admin, {
    clinicId,
    amount: -pending,
    type: "staff_salary_paid",
    descriptionAr: `صرف راتب موظف — ${slip.month_year}`,
    transactionDate: new Date().toISOString().slice(0, 10),
    referenceType: "salary_slip_paid",
    referenceId: confirmReference(slip.id),
  });
  return res.ok
    ? { ok: true, amount: pending }
    : { ok: false, error: res.error };
}

/** تأكيد صرف مساعد — حصة الطبيب والعيادة المتبقية فقط */
export async function recordAssistantPayrollPaidTransaction(
  admin: SupabaseClient,
  clinicId: string,
  record: PayrollRecord,
  deltas?: { doctor?: number; clinic?: number }
): Promise<{ ok: boolean; error?: string; doctorAmount?: number; clinicAmount?: number }> {
  const paidDoctor = roundMoney(Number(record.paid_doctor_share_amount ?? 0));
  const paidClinic = roundMoney(Number(record.paid_clinic_share_amount ?? 0));
  const deltaDoctor = roundMoney(
    deltas?.doctor ??
      Math.max(0, Number(record.doctor_share_amount ?? 0) - paidDoctor)
  );
  const deltaClinic = roundMoney(
    deltas?.clinic ??
      Math.max(0, Number(record.clinic_share_amount ?? 0) - paidClinic)
  );

  if (deltaDoctor <= 0 && deltaClinic <= 0) {
    return { ok: true, doctorAmount: 0, clinicAmount: 0 };
  }

  if (deltaDoctor > 0) {
    const doctorTx = await recordFinancialTransaction(admin, {
      clinicId,
      amount: -deltaDoctor,
      type: "assistant_payroll_doctor",
      descriptionAr: `صرف راتب مساعد ${record.assistant_name_ar} — ${record.month_year}`,
      transactionDate: new Date().toISOString().slice(0, 10),
      doctorId: record.doctor_id,
      referenceType: "payroll_record_paid",
      referenceId: confirmReference(record.id),
    });
    if (!doctorTx.ok) {
      return { ok: false, error: doctorTx.error };
    }
  }

  if (deltaClinic > 0) {
    const clinicTx = await recordFinancialTransaction(admin, {
      clinicId,
      amount: -deltaClinic,
      type: "assistant_payroll_clinic",
      descriptionAr: `حصة عيادة — مساعد ${record.assistant_name_ar} — ${record.month_year}`,
      transactionDate: new Date().toISOString().slice(0, 10),
      referenceType: "payroll_record_clinic_paid",
      referenceId: confirmReference(record.id),
    });
    if (!clinicTx.ok) {
      return { ok: false, error: clinicTx.error };
    }
  }

  return {
    ok: true,
    doctorAmount: deltaDoctor,
    clinicAmount: deltaClinic,
  };
}

/** إلغاء آخر تأكيد صرف لقسيمة موظف/طبيب */
export async function reverseLastStaffSlipPaidTransaction(
  admin: SupabaseClient,
  clinicId: string,
  slip: Pick<SalarySlip, "id" | "doctor_id">
): Promise<{ ok: boolean; error?: string; reversedAmount?: number }> {
  const referenceType = slip.doctor_id
    ? "salary_slip_doctor_paid"
    : "salary_slip_paid";
  const { rows, error } = await listPayrollConfirmTransactions(
    admin,
    clinicId,
    referenceType,
    slip.id
  );
  if (error) return { ok: false, error };

  const last = rows[rows.length - 1];
  if (!last) {
    return reverseStaffSlipPaidTransactionLegacy(admin, clinicId, slip);
  }

  const { error: delErr } = await admin
    .from("transactions")
    .delete()
    .eq("id", last.id);
  if (delErr) return { ok: false, error: delErr.message };

  return {
    ok: true,
    reversedAmount: roundMoney(Math.abs(Number(last.amount ?? 0))),
  };
}

async function reverseStaffSlipPaidTransactionLegacy(
  admin: SupabaseClient,
  clinicId: string,
  slip: Pick<SalarySlip, "id" | "doctor_id">
): Promise<{ ok: boolean; error?: string; reversedAmount?: number }> {
  const referenceType = slip.doctor_id
    ? "salary_slip_doctor_paid"
    : "salary_slip_paid";
  const { data } = await admin
    .from("transactions")
    .select("amount")
    .eq("clinic_id", clinicId)
    .eq("reference_type", referenceType)
    .eq("reference_id", slip.id)
    .maybeSingle();
  const res = await deleteFinancialTransactionsByReference(
    admin,
    clinicId,
    referenceType,
    slip.id
  );
  return res.ok
    ? {
        ok: true,
        reversedAmount: roundMoney(Math.abs(Number(data?.amount ?? 0))),
      }
    : { ok: false, error: res.error };
}

/** @deprecated */
export async function reverseStaffSlipPaidTransaction(
  admin: SupabaseClient,
  clinicId: string,
  slip: Pick<SalarySlip, "id" | "doctor_id">
): Promise<{ ok: boolean; error?: string }> {
  const res = await reverseLastStaffSlipPaidTransaction(admin, clinicId, slip);
  return res.ok ? { ok: true } : { ok: false, error: res.error };
}

/** إلغاء آخر تأكيد صرف لمساعد */
export async function reverseLastAssistantPayrollPaidTransaction(
  admin: SupabaseClient,
  clinicId: string,
  record: Pick<PayrollRecord, "id">
): Promise<{
  ok: boolean;
  error?: string;
  reversedDoctor?: number;
  reversedClinic?: number;
}> {
  const doctorRows = await listPayrollConfirmTransactions(
    admin,
    clinicId,
    "payroll_record_paid",
    record.id
  );
  const clinicRows = await listPayrollConfirmTransactions(
    admin,
    clinicId,
    "payroll_record_clinic_paid",
    record.id
  );

  const lastDoctor = doctorRows.rows[doctorRows.rows.length - 1];
  const lastClinic = clinicRows.rows[clinicRows.rows.length - 1];

  let reversedDoctor = 0;
  let reversedClinic = 0;

  if (lastDoctor) {
    await admin.from("transactions").delete().eq("id", lastDoctor.id);
    reversedDoctor = roundMoney(Math.abs(Number(lastDoctor.amount ?? 0)));
  }
  if (lastClinic) {
    await admin.from("transactions").delete().eq("id", lastClinic.id);
    reversedClinic = roundMoney(Math.abs(Number(lastClinic.amount ?? 0)));
  }

  if (!lastDoctor && !lastClinic) {
    const legacy = await deleteFinancialTransactionsByReference(
      admin,
      clinicId,
      "payroll_record_paid",
      record.id
    );
    return legacy.ok
      ? { ok: true, reversedDoctor: 0, reversedClinic: 0 }
      : { ok: false, error: legacy.error };
  }

  return { ok: true, reversedDoctor, reversedClinic };
}

/** @deprecated */
export async function reverseAssistantPayrollPaidTransaction(
  admin: SupabaseClient,
  clinicId: string,
  record: Pick<PayrollRecord, "id">
): Promise<{ ok: boolean; error?: string }> {
  const res = await reverseLastAssistantPayrollPaidTransaction(
    admin,
    clinicId,
    record
  );
  return res.ok ? { ok: true } : { ok: false, error: res.error };
}

/** لم يعد يُستخدم — الخصم عند التأكيد فقط */
export async function upsertStaffSlipAccrualTransaction(
  admin: SupabaseClient,
  clinicId: string,
  slip: Pick<SalarySlip, "id">
): Promise<{ ok: boolean; error?: string }> {
  await deleteFinancialTransactionsByReference(
    admin,
    clinicId,
    "salary_slip_accrual",
    slip.id
  );
  return { ok: true };
}
