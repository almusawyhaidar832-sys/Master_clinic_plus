import type { SupabaseClient } from "@supabase/supabase-js";
import {
  deleteFinancialTransactionsByReference,
  recordFinancialTransaction,
} from "@/lib/services/clinic-profit";
import { todayISO } from "@/lib/utils";
import type { PayrollRecord, SalarySlip } from "@/types";

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

function confirmReference(parentId: string): string {
  return `${parentId}:${Date.now()}`;
}

function parseAssistantBatchTimestamp(
  referenceId: string,
  parentId: string
): number | null {
  const prefix = `${parentId}:`;
  if (!referenceId.startsWith(prefix)) return null;
  const ts = Number(referenceId.slice(prefix.length));
  return Number.isFinite(ts) ? ts : null;
}

type PayrollConfirmRow = {
  id: string;
  amount: number;
  reference_id: string;
  transaction_date: string;
};

/** تجميع حركات تأكيد المساعد حسب جلسة التأكيد (reference_id) */
function groupAssistantConfirmBatches(
  doctorRows: PayrollConfirmRow[],
  clinicRows: PayrollConfirmRow[],
  parentId: string
): Map<number, { doctor?: PayrollConfirmRow; clinic?: PayrollConfirmRow }> {
  const batches = new Map<
    number,
    { doctor?: PayrollConfirmRow; clinic?: PayrollConfirmRow }
  >();

  const add = (row: PayrollConfirmRow, leg: "doctor" | "clinic") => {
    const ts = parseAssistantBatchTimestamp(String(row.reference_id), parentId);
    if (ts == null) return;
    const batch = batches.get(ts) ?? {};
    batch[leg] = row;
    batches.set(ts, batch);
  };

  for (const row of doctorRows) add(row, "doctor");
  for (const row of clinicRows) add(row, "clinic");
  return batches;
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
    .eq("reference_type", referenceType);

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

  const prefix = `${parentId}:`;
  const rows = (data ?? []).filter((r) => {
    const ref = String(r.reference_id ?? "");
    return ref === parentId || ref.startsWith(prefix);
  });
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
    transactionDate: todayISO(),
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
    transactionDate: todayISO(),
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

  const batchReferenceId = confirmReference(record.id);

  if (deltaDoctor > 0) {
    const doctorTx = await recordFinancialTransaction(admin, {
      clinicId,
      amount: -deltaDoctor,
      type: "assistant_payroll_doctor",
      descriptionAr: `صرف راتب مساعد ${record.assistant_name_ar} — ${record.month_year}`,
      transactionDate: todayISO(),
      doctorId: record.doctor_id,
      referenceType: "payroll_record_paid",
      referenceId: batchReferenceId,
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
      transactionDate: todayISO(),
      referenceType: "payroll_record_clinic_paid",
      referenceId: batchReferenceId,
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

/** إلغاء آخر تأكيد صرف لمساعد — جلسة واحدة (طبيب + عيادة بنفس reference_id) */
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

  if (doctorRows.error) {
    return { ok: false, error: doctorRows.error };
  }
  if (clinicRows.error) {
    return { ok: false, error: clinicRows.error };
  }

  const batches = groupAssistantConfirmBatches(
    doctorRows.rows,
    clinicRows.rows,
    record.id
  );

  if (batches.size === 0) {
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

  const lastBatchTs = Math.max(...batches.keys());
  const batch = batches.get(lastBatchTs);
  if (!batch) {
    return { ok: false, error: "تعذر تحديد جلسة الإلغاء" };
  }

  let reversedDoctor = 0;
  let reversedClinic = 0;

  if (batch.doctor) {
    const { error: delDoctorErr } = await admin
      .from("transactions")
      .delete()
      .eq("id", batch.doctor.id);
    if (delDoctorErr) {
      return { ok: false, error: delDoctorErr.message };
    }
    reversedDoctor = roundMoney(Math.abs(Number(batch.doctor.amount ?? 0)));
  }

  if (batch.clinic) {
    const { error: delClinicErr } = await admin
      .from("transactions")
      .delete()
      .eq("id", batch.clinic.id);
    if (delClinicErr) {
      return { ok: false, error: delClinicErr.message };
    }
    reversedClinic = roundMoney(Math.abs(Number(batch.clinic.amount ?? 0)));
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
