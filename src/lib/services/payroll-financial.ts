import type { SupabaseClient } from "@supabase/supabase-js";
import {
  deleteFinancialTransactionsByReference,
  recordFinancialTransaction,
} from "@/lib/services/clinic-profit";
import { breakdownAssistantSalary } from "@/lib/services/assistant-payroll";
import { todayISO } from "@/lib/utils";
import type { PayrollRecord, SalarySlip } from "@/types";

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * مرجع مالي ثابت (بدون طابع زمني) مبني على معرّف الأب + المبلغ المدفوع
 * *قبل* هذا التأكيد. هذا يجعل استدعاءين متزامنين (ضغطة مزدوجة/إعادة محاولة)
 * لنفس عملية التأكيد ينتجان نفس المرجع تماماً — فيمنعهما قيد التفرّد
 * بقاعدة البيانات (clinic_id, reference_type, reference_id) من التسبب
 * بخصم مضاعف. أي تأكيد لاحق حقيقي (زيادة جديدة بالمستحقات) يُنتج مرجعاً
 * مختلفاً لأن "المدفوع سابقاً" يتغيّر بعد كل تأكيد ناجح.
 */
function confirmReference(parentId: string, fromAmount: number): string {
  return `${parentId}:from:${roundMoney(fromAmount)}`;
}

/** نفس فكرة confirmReference لكن لجلسة مساعد بساقين (طبيب + عيادة) معاً */
function confirmBatchReference(
  parentId: string,
  fromDoctor: number,
  fromClinic: number
): string {
  return `${parentId}:from:${roundMoney(fromDoctor)}:${roundMoney(fromClinic)}`;
}

type PayrollConfirmRow = {
  id: string;
  amount: number;
  reference_id: string;
  transaction_date: string;
  created_at: string;
};

/** تجميع حركات تأكيد المساعد حسب جلسة التأكيد (reference_id) — الساقان
 * (طبيب/عيادة) لنفس الجلسة تتشاركان نفس reference_id بالضبط (النوعان
 * مختلفان: payroll_record_paid / payroll_record_clinic_paid) */
function groupAssistantConfirmBatches(
  doctorRows: PayrollConfirmRow[],
  clinicRows: PayrollConfirmRow[]
): Map<string, { doctor?: PayrollConfirmRow; clinic?: PayrollConfirmRow }> {
  const batches = new Map<
    string,
    { doctor?: PayrollConfirmRow; clinic?: PayrollConfirmRow }
  >();

  const add = (row: PayrollConfirmRow, leg: "doctor" | "clinic") => {
    const key = String(row.reference_id);
    const batch = batches.get(key) ?? {};
    batch[leg] = row;
    batches.set(key, batch);
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
    .select("id, amount, reference_id, transaction_date, created_at")
    .eq("clinic_id", clinicId)
    .eq("reference_type", referenceType);

  if (error) {
    return {
      rows: [] as PayrollConfirmRow[],
      error: error.message,
    };
  }

  const prefix = `${parentId}:`;
  const rows = (data ?? []).filter((r) => {
    const ref = String(r.reference_id ?? "");
    return ref === parentId || ref.startsWith(prefix);
  }) as PayrollConfirmRow[];
  // الترتيب الزمني الحقيقي (created_at) — لا يمكن الاعتماد على ترتيب نص
  // reference_id أبجدياً بعد أن أصبح مبنياً على قيمة المبلغ لا الوقت
  rows.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
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
    referenceId: confirmReference(slip.id, paid),
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
    referenceId: confirmReference(slip.id, paid),
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
  let deltaDoctor = roundMoney(
    deltas?.doctor ??
      Math.max(0, Number(record.doctor_share_amount ?? 0) - paidDoctor)
  );
  let deltaClinic = roundMoney(
    deltas?.clinic ??
      Math.max(0, Number(record.clinic_share_amount ?? 0) - paidClinic)
  );

  const sharePct = Number(record.doctor_share_percentage ?? 0);
  const accrued = breakdownAssistantSalary({
    total_salary: Number(record.total_salary ?? 0),
    doctor_share_percentage: sharePct,
  });
  const maxDoctor = roundMoney(Math.max(0, accrued.doctorShare - paidDoctor));
  const maxClinic = roundMoney(Math.max(0, accrued.clinicShare - paidClinic));
  if (deltaDoctor > maxDoctor + 0.01) {
    deltaDoctor = maxDoctor;
  }
  if (deltaClinic > maxClinic + 0.01) {
    deltaClinic = maxClinic;
  }

  if (deltaDoctor <= 0 && deltaClinic <= 0) {
    return { ok: true, doctorAmount: 0, clinicAmount: 0 };
  }

  const batchReferenceId = confirmBatchReference(
    record.id,
    paidDoctor,
    paidClinic
  );

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

export const ASSISTANT_ENTRY_DOCTOR_REF = "salary_entry_assistant_doctor";
export const ASSISTANT_ENTRY_CLINIC_REF = "salary_entry_assistant_clinic";

export async function isAssistantDailyEntryConfirmed(
  admin: SupabaseClient,
  clinicId: string,
  entryId: string
): Promise<boolean> {
  const { rows } = await listPayrollConfirmTransactions(
    admin,
    clinicId,
    ASSISTANT_ENTRY_CLINIC_REF,
    entryId
  );
  return rows.length > 0;
}

export async function listConfirmedAssistantDailyEntryIds(
  admin: SupabaseClient,
  clinicId: string,
  entryIds: string[]
): Promise<Set<string>> {
  if (entryIds.length === 0) return new Set();
  const { data, error } = await admin
    .from("transactions")
    .select("reference_id")
    .eq("clinic_id", clinicId)
    .eq("reference_type", ASSISTANT_ENTRY_CLINIC_REF)
    .in("reference_id", entryIds);

  if (error) {
    return new Set();
  }

  return new Set((data ?? []).map((row) => String(row.reference_id)));
}

/** تأكيد صرف أجر يومي واحد لمساعد — مرجع الحركة = معرّف الحركة */
export async function recordAssistantDailyEntryPaidTransaction(
  admin: SupabaseClient,
  clinicId: string,
  record: PayrollRecord,
  entryId: string,
  entryAmount: number,
  doctorSharePct: number,
  assistantNameAr: string,
  monthYear: string
): Promise<{
  ok: boolean;
  error?: string;
  doctorAmount?: number;
  clinicAmount?: number;
}> {
  const entryBreakdown = breakdownAssistantSalary({
    total_salary: entryAmount,
    doctor_share_percentage: doctorSharePct,
  });
  // ملاحظة: لا نُقيّد deltaDoctor/deltaClinic بسقف مبني على record.total_salary
  // هنا — بعد recomputeAssistantPayrollRecord تصبح تلك القيمة "المتبقي بعد
  // الدفوعات" (net of paid) لا "الإجمالي المُستحَق"، فطرح paidDoctor/paidClinic
  // منها ثانية كان يُضاعِف الخصم السابق ويُصفّر سقف التأكيدات اللاحقة (كل حركة
  // تالية تُرفض بصمت: ok:true لكن doctorAmount/clinicAmount = 0). كل حركة أجر
  // يومي فريدة بمعرّفها (entryId) والتحقق من عدم تكرار تأكيدها يتم مسبقاً في
  // route.ts عبر isAssistantDailyEntryConfirmed، فمبلغ الحركة نفسه كافٍ كمرجع.
  const deltaDoctor = entryBreakdown.doctorShare;
  const deltaClinic = entryBreakdown.clinicShare;

  if (deltaDoctor <= 0 && deltaClinic <= 0) {
    return { ok: true, doctorAmount: 0, clinicAmount: 0 };
  }

  if (deltaDoctor > 0) {
    const doctorTx = await recordFinancialTransaction(admin, {
      clinicId,
      amount: -deltaDoctor,
      type: "assistant_payroll_doctor",
      descriptionAr: `صرف أجر يومي — مساعد ${assistantNameAr} — ${monthYear}`,
      transactionDate: todayISO(),
      doctorId: record.doctor_id,
      referenceType: ASSISTANT_ENTRY_DOCTOR_REF,
      referenceId: entryId,
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
      descriptionAr: `حصة عيادة — أجر يومي مساعد ${assistantNameAr} — ${monthYear}`,
      transactionDate: todayISO(),
      referenceType: ASSISTANT_ENTRY_CLINIC_REF,
      referenceId: entryId,
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

  const batches = groupAssistantConfirmBatches(doctorRows.rows, clinicRows.rows);

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

  // آخر جلسة تأكيد فعلياً — بترتيب created_at الحقيقي، ليس نص المرجع
  let lastKey: string | null = null;
  let lastCreatedAt = "";
  for (const [key, entry] of batches) {
    const createdAt = entry.doctor?.created_at ?? entry.clinic?.created_at ?? "";
    if (createdAt >= lastCreatedAt) {
      lastCreatedAt = createdAt;
      lastKey = key;
    }
  }
  const batch = lastKey ? batches.get(lastKey) : undefined;
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

/** تصحيح — إرجاع جزء من خصم الطبيب/العيادة بعد حذف أو تعديل حركة (بدون لمس تأكيدات سابقة) */
export async function creditAssistantPayrollAmounts(
  admin: SupabaseClient,
  clinicId: string,
  record: Pick<
    PayrollRecord,
    "id" | "doctor_id" | "assistant_name_ar" | "month_year"
  >,
  amounts: { doctor: number; clinic: number },
  descriptionSuffix: string,
  referenceId: string
): Promise<{ ok: boolean; error?: string }> {
  const doctorCredit = roundMoney(amounts.doctor);
  const clinicCredit = roundMoney(amounts.clinic);

  if (doctorCredit > 0) {
    const res = await recordFinancialTransaction(admin, {
      clinicId,
      amount: doctorCredit,
      type: "assistant_payroll_doctor",
      descriptionAr: `تصحيح — مساعد ${record.assistant_name_ar} — ${descriptionSuffix}`,
      transactionDate: todayISO(),
      doctorId: record.doctor_id,
      referenceType: "payroll_entry_adjustment",
      referenceId,
    });
    if (!res.ok) return { ok: false, error: res.error };
  }

  if (clinicCredit > 0) {
    const res = await recordFinancialTransaction(admin, {
      clinicId,
      amount: clinicCredit,
      type: "assistant_payroll_clinic",
      descriptionAr: `تصحيح — مساعد ${record.assistant_name_ar} — ${descriptionSuffix}`,
      transactionDate: todayISO(),
      referenceType: "payroll_entry_adjustment_clinic",
      referenceId,
    });
    if (!res.ok) return { ok: false, error: res.error };
  }

  return { ok: true };
}
