import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { breakdownAssistantSalary } from "@/lib/services/assistant-payroll";
import {
  computeAssistantNetPay,
  computeStaffNetPay,
  summarizeSalaryEntries as summarizeEntriesMath,
} from "@/lib/services/salary-entry-math";
import {
  isDailyWageAssistant,
  isDailyWage,
  normalizeAssistantCompensationMode,
  normalizeCompensationMode,
} from "@/lib/services/assistant-compensation";
import { validateSalaryEntryReason } from "@/lib/services/salary-entry-reason";
import {
  assistantIsFullyPaid,
  assistantPaidClinicShare,
  assistantPaidDoctorShare,
  assistantPaidTotalSalary,
  assistantPendingDoctorShare,
  slipIsFullyPaid,
  slipPaidNet,
} from "@/lib/services/payroll-paid-portions";
import {
  creditAssistantPayrollAmounts,
  reverseLastStaffSlipPaidTransaction,
} from "@/lib/services/payroll-financial";
import { FINANCIAL_EPSILON } from "@/lib/services/patient-financial-plan";
import { isMonthClosed } from "@/lib/services/salary-payroll";
import { calculateSalaryNet, monthDateRange } from "@/lib/utils";
import type { PayrollRecord, SalaryEntry, SalaryEntryType, SalarySlip } from "@/types";

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

async function fetchAssistantPendingDoctorShare(
  admin: SupabaseClient,
  clinicId: string,
  assistantId: string,
  monthYear: string
): Promise<number> {
  const base = await loadAssistantPayrollBase(admin, clinicId, assistantId);
  if (base.error) return 0;

  const dailyWage = isDailyWageAssistant(base.compensationMode);
  const { from, to } = monthDateRange(monthYear);

  if (dailyWage) {
    const { fetchRegisteredAssistantPayrollDoctorDeductionForAssistant } =
      await import("@/lib/ledger/daily-assistant-payroll");
    return fetchRegisteredAssistantPayrollDoctorDeductionForAssistant(
      admin,
      clinicId,
      assistantId,
      from,
      to
    );
  }

  const { data: record } = await admin
    .from("payroll_records")
    .select(
      "doctor_share_percentage, doctor_share_amount, paid_doctor_share_amount, clinic_share_amount, paid_clinic_share_amount, total_salary, paid_total_salary, status"
    )
    .eq("clinic_id", clinicId)
    .eq("assistant_id", assistantId)
    .eq("month_year", monthYear)
    .maybeSingle();

  if (record) {
    return assistantPendingDoctorShare(record as PayrollRecord, {
      dailyWage: false,
      doctorSharePercentage: base.doctorSharePercentage,
    });
  }

  return 0;
}

function notifyDoctorAssistantPayrollChangeIfNeeded(
  admin: SupabaseClient,
  clinicId: string,
  assistantId: string,
  monthYear: string,
  beforePending: number,
  action: "registered" | "updated" | "removed",
  entryDate?: string
): void {
  void (async () => {
    const afterPending = await fetchAssistantPendingDoctorShare(
      admin,
      clinicId,
      assistantId,
      monthYear
    );
    const amountDelta = roundMoney(afterPending - beforePending);
    if (Math.abs(amountDelta) <= FINANCIAL_EPSILON) return;

    const { data: assistant } = await admin
      .from("assistants")
      .select("doctor_id, full_name_ar")
      .eq("id", assistantId)
      .eq("clinic_id", clinicId)
      .maybeSingle();
    if (!assistant?.doctor_id) return;

    const { notifyDoctorAssistantPayrollDeduction } = await import(
      "@/lib/notifications/server"
    );
    await notifyDoctorAssistantPayrollDeduction({
      clinicId,
      doctorId: String(assistant.doctor_id),
      assistantName: String(assistant.full_name_ar ?? "مساعد"),
      monthYear,
      amountDelta,
      action,
      entryDate,
    });
  })().catch((err) => {
    console.error("[salary-entry] doctor payroll deduction notify failed:", err);
  });
}

const ENTRY_TYPES: SalaryEntryType[] = [
  "advance",
  "deduction",
  "absence",
  "bonus",
  "daily_wage",
];

export function isSalaryEntryType(value: string): value is SalaryEntryType {
  return ENTRY_TYPES.includes(value as SalaryEntryType);
}

export const summarizeSalaryEntries = summarizeEntriesMath;

function mapInsertError(message: string): string {
  if (
    message.includes("salary_entry_type") ||
    message.toLowerCase().includes("invalid input value for enum")
  ) {
    return "نوع الحركة غير مدعوم — شغّل supabase/scripts/30-assistant-daily-wage.sql في Supabase";
  }
  if (
    message.includes("assistant_id") ||
    message.includes("salary_entries_staff_or_assistant_check") ||
    message.includes("salary_entries_person_check")
  ) {
    return "قاعدة البيانات تحتاج تحديث — شغّل supabase/scripts/36-salary-entry-assistant.sql و 37-salary-entry-doctor.sql في Supabase";
  }
  if (
    message.includes("doctor_id") ||
    message.includes("salary_slips_staff_or_doctor_check")
  ) {
    return "قاعدة البيانات تحتاج تحديث — شغّل supabase/scripts/37-salary-entry-doctor.sql في Supabase";
  }
  if (
    message.includes("compensation_mode") &&
    message.includes("staff_members")
  ) {
    return "قاعدة البيانات تحتاج تحديث — شغّل supabase/scripts/32-staff-daily-wage.sql في Supabase";
  }
  return message;
}

export async function listSalaryEntriesForPersonMonth(
  admin: SupabaseClient,
  clinicId: string,
  monthYear: string,
  opts: { staffId?: string; assistantId?: string; doctorId?: string }
): Promise<{ entries: SalaryEntry[]; error?: string }> {
  const staffId = opts.staffId?.trim() ?? "";
  const assistantId = opts.assistantId?.trim() ?? "";
  const doctorId = opts.doctorId?.trim() ?? "";
  if (!staffId && !assistantId && !doctorId) {
    return { entries: [] };
  }

  const { from, to } = monthDateRange(monthYear);
  let query = admin
    .from("salary_entries")
    .select("*")
    .eq("clinic_id", clinicId)
    .gte("entry_date", from)
    .lte("entry_date", to)
    .order("entry_date", { ascending: false });

  if (staffId) {
    query = query.eq("staff_id", staffId);
  } else if (assistantId) {
    query = query.eq("assistant_id", assistantId);
  } else {
    query = query.eq("doctor_id", doctorId);
  }

  const { data, error } = await query;
  if (error) {
    return { entries: [], error: error.message };
  }
  return { entries: (data as SalaryEntry[]) ?? [] };
}

export async function syncStaffSalarySlipDraft(
  admin: SupabaseClient,
  clinicId: string,
  staffId: string,
  monthYear: string
): Promise<{
  slip: SalarySlip | null;
  isDailyWage?: boolean;
  error?: string;
}> {
  const { data: staff, error: staffErr } = await admin
    .from("staff_members")
    .select("base_salary, compensation_mode")
    .eq("id", staffId)
    .eq("clinic_id", clinicId)
    .maybeSingle();

  if (staffErr || !staff) {
    return { slip: null, error: staffErr?.message ?? "الموظف غير موجود" };
  }

  const compensationMode = normalizeCompensationMode(
    staff.compensation_mode as string | undefined
  );
  const baseSalary = isDailyWage(compensationMode)
    ? 0
    : Number(staff.base_salary ?? 0);

  const { entries, error: listErr } = await listSalaryEntriesForPersonMonth(
    admin,
    clinicId,
    monthYear,
    { staffId }
  );
  if (listErr) {
    return { slip: null, error: listErr };
  }

  const { advances, deductions, netPayout } = computeStaffNetPay(
    baseSalary,
    entries,
    compensationMode
  );

  const { data: existing, error: fetchErr } = await admin
    .from("salary_slips")
    .select("*")
    .eq("clinic_id", clinicId)
    .eq("staff_id", staffId)
    .eq("month_year", monthYear)
    .maybeSingle();

  if (fetchErr) {
    return { slip: null, error: fetchErr.message };
  }

  if (existing?.status === "paid" && !isDailyWage(compensationMode)) {
    return {
      slip: existing as SalarySlip,
      isDailyWage: isDailyWage(compensationMode),
    };
  }

  const paidNet = roundMoney(Number(existing?.paid_net_payout ?? 0));
  const storedNet = isDailyWage(compensationMode)
    ? roundMoney(Math.max(0, netPayout - paidNet))
    : netPayout;
  const status =
    storedNet <= 0 && paidNet > 0 ? ("paid" as const) : ("draft" as const);

  const payload = {
    clinic_id: clinicId,
    staff_id: staffId,
    month_year: monthYear,
    base_salary: baseSalary,
    total_advances: advances,
    total_deductions: deductions,
    net_payout: storedNet,
    status,
  };

  const { data, error } = existing
    ? await admin
        .from("salary_slips")
        .update({
          base_salary: payload.base_salary,
          total_advances: payload.total_advances,
          total_deductions: payload.total_deductions,
          net_payout: payload.net_payout,
          status,
        })
        .eq("id", existing.id)
        .select("*")
        .single()
    : await admin.from("salary_slips").insert(payload).select("*").single();

  if (error) {
    return { slip: null, error: error.message };
  }

  const slip = data as SalarySlip;
  return { slip, isDailyWage: isDailyWage(compensationMode) };
}

export async function syncDoctorSalarySlipDraft(
  admin: SupabaseClient,
  clinicId: string,
  doctorId: string,
  monthYear: string,
  baseSalary: number
): Promise<{ slip: SalarySlip | null; error?: string }> {
  const { entries, error: listErr } = await listSalaryEntriesForPersonMonth(
    admin,
    clinicId,
    monthYear,
    { doctorId }
  );
  if (listErr) {
    return { slip: null, error: listErr };
  }

  const { advances, deductions, netPayout } = computeStaffNetPay(
    baseSalary,
    entries
  );

  const { data: existing, error: fetchErr } = await admin
    .from("salary_slips")
    .select("*")
    .eq("clinic_id", clinicId)
    .eq("doctor_id", doctorId)
    .eq("month_year", monthYear)
    .maybeSingle();

  if (fetchErr) {
    return { slip: null, error: fetchErr.message };
  }

  if (existing?.status === "paid") {
    return { slip: existing as SalarySlip };
  }

  const payload = {
    clinic_id: clinicId,
    doctor_id: doctorId,
    month_year: monthYear,
    base_salary: baseSalary,
    total_advances: advances,
    total_deductions: deductions,
    net_payout: netPayout,
    status: "draft" as const,
  };

  const { data, error } = existing
    ? await admin
        .from("salary_slips")
        .update({
          base_salary: payload.base_salary,
          total_advances: payload.total_advances,
          total_deductions: payload.total_deductions,
          net_payout: payload.net_payout,
          status: "draft",
        })
        .eq("id", existing.id)
        .select("*")
        .single()
    : await admin.from("salary_slips").insert(payload).select("*").single();

  if (error) {
    return { slip: null, error: error.message };
  }

  return { slip: data as SalarySlip };
}

async function loadAssistantPayrollBase(
  admin: SupabaseClient,
  clinicId: string,
  assistantId: string
): Promise<{
  baseSalary: number;
  doctorSharePercentage: number;
  compensationMode: ReturnType<typeof normalizeAssistantCompensationMode>;
  error?: string;
}> {
  const { data, error } = await admin
    .from("assistants")
    .select("total_salary, doctor_share_percentage, compensation_mode")
    .eq("id", assistantId)
    .eq("clinic_id", clinicId)
    .maybeSingle();

  if (error) {
    return {
      baseSalary: 0,
      doctorSharePercentage: 0,
      compensationMode: "monthly_fixed",
      error: error.message,
    };
  }
  if (!data) {
    return {
      baseSalary: 0,
      doctorSharePercentage: 0,
      compensationMode: "monthly_fixed",
      error: "المساعد غير موجود",
    };
  }

  const compensationMode = normalizeAssistantCompensationMode(
    data.compensation_mode as string | undefined
  );

  return {
    baseSalary: isDailyWageAssistant(compensationMode)
      ? 0
      : Number(data.total_salary ?? 0),
    doctorSharePercentage: Number(data.doctor_share_percentage ?? 0),
    compensationMode,
  };
}

/** إعادة حساب سجل راتب مساعد — يستخدم النسبة الحالية من جدول assistants */
export async function recomputeAssistantPayrollRecord(
  admin: SupabaseClient,
  clinicId: string,
  assistantId: string,
  monthYear: string
): Promise<{
  record: PayrollRecord | null;
  netTotal: number;
  dailyWage?: boolean;
  error?: string;
}> {
  const base = await loadAssistantPayrollBase(admin, clinicId, assistantId);
  if (base.error) {
    return { record: null, netTotal: 0, error: base.error };
  }

  const { entries, error: listErr } = await listSalaryEntriesForPersonMonth(
    admin,
    clinicId,
    monthYear,
    { assistantId }
  );
  if (listErr) {
    return { record: null, netTotal: 0, error: listErr };
  }

  const { advances, deductions, bonuses } = summarizeSalaryEntries(entries);
  const { netPayout: fullNet } = computeAssistantNetPay(
    base.compensationMode,
    base.baseSalary,
    entries
  );

  const { data: existing, error: fetchErr } = await admin
    .from("payroll_records")
    .select("*")
    .eq("clinic_id", clinicId)
    .eq("assistant_id", assistantId)
    .eq("month_year", monthYear)
    .maybeSingle();

  if (fetchErr) {
    return { record: null, netTotal: fullNet, error: fetchErr.message };
  }

  if (!existing) {
    return {
      record: null,
      netTotal: fullNet,
      error: "لا يوجد راتب مُولَّد لهذا المساعد — اضغط «توليد رواتب الشهر» أولاً",
    };
  }

  if (
    existing.status === "paid" &&
    !isDailyWageAssistant(base.compensationMode)
  ) {
    return {
      record: existing as PayrollRecord,
      netTotal: fullNet,
      dailyWage: isDailyWageAssistant(base.compensationMode),
    };
  }

  const paidDoctor = roundMoney(Number(existing.paid_doctor_share_amount ?? 0));
  const paidClinic = roundMoney(Number(existing.paid_clinic_share_amount ?? 0));
  const paidTotal = roundMoney(Number(existing.paid_total_salary ?? 0));
  const dailyWage = isDailyWageAssistant(base.compensationMode);
  const pendingNet = dailyWage
    ? roundMoney(Math.max(0, fullNet - paidTotal))
    : fullNet;
  const breakdownBase = dailyWage ? pendingNet : fullNet;

  const breakdown = breakdownAssistantSalary({
    total_salary: breakdownBase,
    doctor_share_percentage: base.doctorSharePercentage,
  });

  const nextRecord = {
    ...(existing as PayrollRecord),
    total_salary: pendingNet,
    doctor_share_amount: breakdown.doctorShare,
    clinic_share_amount: breakdown.clinicShare,
    paid_doctor_share_amount: paidDoctor,
    paid_clinic_share_amount: paidClinic,
    paid_total_salary: paidTotal,
  };
  const fullyPaid = assistantIsFullyPaid(nextRecord, { dailyWage });
  const status = fullyPaid ? ("paid" as const) : ("generated" as const);

  const { data, error } = await admin
    .from("payroll_records")
    .update({
      total_salary: pendingNet,
      doctor_share_percentage: breakdown.doctorSharePercentage,
      doctor_share_amount: breakdown.doctorShare,
      clinic_share_amount: breakdown.clinicShare,
      status,
    })
    .eq("id", existing.id)
    .select("*")
    .single();

  if (error) {
    return { record: null, netTotal: fullNet, error: error.message };
  }

  return {
    record: data as PayrollRecord,
    netTotal: pendingNet,
    dailyWage,
  };
}

function assistantDoctorName(
  doctor: { full_name_ar: string } | { full_name_ar: string }[] | null
): string {
  if (!doctor) return "";
  if (Array.isArray(doctor)) return doctor[0]?.full_name_ar ?? "";
  return doctor.full_name_ar;
}

/** إنشاء سجل راتب مساعد عند أول حركة إن لم يُولَّد الشهر بعد */
export async function ensureAssistantPayrollRecordDraft(
  admin: SupabaseClient,
  clinicId: string,
  assistantId: string,
  monthYear: string
): Promise<{ record: PayrollRecord | null; error?: string }> {
  const { data: existing } = await admin
    .from("payroll_records")
    .select("*")
    .eq("clinic_id", clinicId)
    .eq("assistant_id", assistantId)
    .eq("month_year", monthYear)
    .maybeSingle();

  if (existing) {
    return { record: existing as PayrollRecord };
  }

  const { data: assistant, error: asstErr } = await admin
    .from("assistants")
    .select(
      `id, doctor_id, full_name_ar, total_salary, doctor_share_percentage, compensation_mode,
       doctor:doctors ( full_name_ar )`
    )
    .eq("id", assistantId)
    .eq("clinic_id", clinicId)
    .maybeSingle();

  if (asstErr || !assistant) {
    return {
      record: null,
      error: asstErr?.message ?? "المساعد غير موجود",
    };
  }

  const compensationMode = normalizeAssistantCompensationMode(
    assistant.compensation_mode as string | undefined
  );
  const baseSalary = isDailyWageAssistant(compensationMode)
    ? 0
    : Number(assistant.total_salary ?? 0);

  const { entries, error: listErr } = await listSalaryEntriesForPersonMonth(
    admin,
    clinicId,
    monthYear,
    { assistantId }
  );
  if (listErr) {
    return { record: null, error: listErr };
  }

  const { netPayout } = computeAssistantNetPay(
    compensationMode,
    baseSalary,
    entries
  );
  const breakdown = breakdownAssistantSalary({
    total_salary: netPayout,
    doctor_share_percentage: Number(assistant.doctor_share_percentage ?? 0),
  });

  const { data, error } = await admin
    .from("payroll_records")
    .insert({
      clinic_id: clinicId,
      assistant_id: assistantId,
      doctor_id: assistant.doctor_id as string,
      month_year: monthYear,
      assistant_name_ar: assistant.full_name_ar as string,
      doctor_name_ar: assistantDoctorName(
        assistant.doctor as
          | { full_name_ar: string }
          | { full_name_ar: string }[]
          | null
      ),
      total_salary: netPayout,
      doctor_share_percentage: breakdown.doctorSharePercentage,
      doctor_share_amount: breakdown.doctorShare,
      clinic_share_amount: breakdown.clinicShare,
      status: "generated",
    })
    .select("*")
    .single();

  if (error) {
    return { record: null, error: error.message };
  }

  return { record: data as PayrollRecord };
}

export async function syncAssistantPayrollRecord(
  admin: SupabaseClient,
  clinicId: string,
  assistantId: string,
  monthYear: string,
  _baseSalary?: number
): Promise<{ record: PayrollRecord | null; error?: string }> {
  const ensured = await ensureAssistantPayrollRecordDraft(
    admin,
    clinicId,
    assistantId,
    monthYear
  );
  if (ensured.error && !ensured.record) {
    return { record: null, error: ensured.error };
  }

  const result = await recomputeAssistantPayrollRecord(
    admin,
    clinicId,
    assistantId,
    monthYear
  );
  return { record: result.record, error: result.error };
}

/** بعد تعديل راتب/نسبة المساعد — تحديث كل السجلات غير المُصرفة */
export async function refreshUnpaidAssistantPayrollRecords(
  admin: SupabaseClient,
  clinicId: string,
  assistantId: string
): Promise<{ updated: number; error?: string }> {
  const { data: rows, error } = await admin
    .from("payroll_records")
    .select("month_year")
    .eq("clinic_id", clinicId)
    .eq("assistant_id", assistantId)
    .neq("status", "paid");

  if (error) {
    return { updated: 0, error: error.message };
  }

  let updated = 0;
  for (const row of rows ?? []) {
    const monthYear = row.month_year as string;
    const { record, error: recomputeErr } = await recomputeAssistantPayrollRecord(
      admin,
      clinicId,
      assistantId,
      monthYear
    );
    if (recomputeErr && !record) {
      return { updated, error: recomputeErr };
    }
    if (record) updated += 1;
  }

  return { updated };
}

/** بعد تعديل راتب موظف عيادة — تحديث كل القسائم غير المُسلَّمة */
export async function refreshUnpaidStaffSalarySlips(
  admin: SupabaseClient,
  clinicId: string,
  staffId: string
): Promise<{ updated: number; error?: string }> {
  const { data: staff, error: staffErr } = await admin
    .from("staff_members")
    .select("base_salary, compensation_mode")
    .eq("id", staffId)
    .eq("clinic_id", clinicId)
    .maybeSingle();

  if (staffErr) {
    return { updated: 0, error: staffErr.message };
  }
  if (!staff) {
    return { updated: 0, error: "الموظف غير موجود" };
  }

  void staff;

  const { data: rows, error } = await admin
    .from("salary_slips")
    .select("month_year")
    .eq("clinic_id", clinicId)
    .eq("staff_id", staffId)
    .neq("status", "paid");

  if (error) {
    return { updated: 0, error: error.message };
  }

  let updated = 0;
  for (const row of rows ?? []) {
    const monthYear = row.month_year as string;
    const { slip, error: syncErr } = await syncStaffSalarySlipDraft(
      admin,
      clinicId,
      staffId,
      monthYear
    );
    if (syncErr && !slip) {
      return { updated, error: syncErr };
    }
    if (slip) updated += 1;
  }

  return { updated };
}

/** بعد تعديل راتب طبيب ثابت — تحديث قسائم غير المُسلَّمة */
export async function refreshUnpaidDoctorSalarySlips(
  admin: SupabaseClient,
  clinicId: string,
  doctorId: string
): Promise<{ updated: number; error?: string }> {
  const { data: doctor, error: doctorErr } = await admin
    .from("doctors")
    .select("salary_amount, payment_type")
    .eq("id", doctorId)
    .eq("clinic_id", clinicId)
    .maybeSingle();

  if (doctorErr) {
    return { updated: 0, error: doctorErr.message };
  }
  if (!doctor || doctor.payment_type !== "salary") {
    return { updated: 0, error: "الطبيب ليس على نظام الراتب الثابت" };
  }

  const baseSalary = Number(doctor.salary_amount ?? 0);

  const { data: rows, error } = await admin
    .from("salary_slips")
    .select("month_year")
    .eq("clinic_id", clinicId)
    .eq("doctor_id", doctorId)
    .neq("status", "paid");

  if (error) {
    return { updated: 0, error: error.message };
  }

  let updated = 0;
  for (const row of rows ?? []) {
    const monthYear = row.month_year as string;
    const { slip, error: syncErr } = await syncDoctorSalarySlipDraft(
      admin,
      clinicId,
      doctorId,
      monthYear,
      baseSalary
    );
    if (syncErr && !slip) {
      return { updated, error: syncErr };
    }
    if (slip) updated += 1;
  }

  return { updated };
}

export async function createSalaryEntry(
  admin: SupabaseClient,
  input: {
    clinicId: string;
    staffId?: string;
    assistantId?: string;
    doctorId?: string;
    monthYear: string;
    baseSalary: number;
    entryType: SalaryEntryType;
    amount: number;
    entryDate: string;
    notesAr?: string | null;
    createdBy?: string | null;
  }
): Promise<{
  entry: SalaryEntry | null;
  entries: SalaryEntry[];
  slip: SalarySlip | null;
  payrollRecord: PayrollRecord | null;
  netPayout: number;
  error?: string;
  notice?: string;
}> {
  let notice: string | undefined;
  let assistantPayrollPendingBefore = 0;
  const staffId = input.staffId?.trim() ?? "";
  const assistantId = input.assistantId?.trim() ?? "";
  const doctorId = input.doctorId?.trim() ?? "";
  const idCount = [staffId, assistantId, doctorId].filter(Boolean).length;
  if (idCount === 0) {
    return {
      entry: null,
      entries: [],
      slip: null,
      payrollRecord: null,
      netPayout: 0,
      error: "حدد الموظف",
    };
  }
  if (idCount > 1) {
    return {
      entry: null,
      entries: [],
      slip: null,
      payrollRecord: null,
      netPayout: 0,
      error: "معرّف موظف غير صالح",
    };
  }

  const reasonError = validateSalaryEntryReason(
    input.entryType,
    input.notesAr
  );
  if (reasonError) {
    return {
      entry: null,
      entries: [],
      slip: null,
      payrollRecord: null,
      netPayout: 0,
      error: reasonError,
    };
  }

  const { from, to } = monthDateRange(input.monthYear);
  if (input.entryDate < from || input.entryDate > to) {
    return {
      entry: null,
      entries: [],
      slip: null,
      payrollRecord: null,
      netPayout: 0,
      error: `تاريخ الحركة يجب أن يكون داخل ${input.monthYear}`,
    };
  }

  let baseSalary = input.baseSalary;
  let assistantCompensationMode: ReturnType<
    typeof normalizeAssistantCompensationMode
  > | null = null;
  let staffCompensationMode: ReturnType<
    typeof normalizeCompensationMode
  > | null = null;

  if (staffId) {
    const { data: staff, error: staffErr } = await admin
      .from("staff_members")
      .select("id, base_salary, compensation_mode")
      .eq("id", staffId)
      .eq("clinic_id", input.clinicId)
      .maybeSingle();

    if (staffErr || !staff) {
      return {
        entry: null,
        entries: [],
        slip: null,
        payrollRecord: null,
        netPayout: 0,
        error: "الموظف غير موجود",
      };
    }

    const compensationMode = normalizeCompensationMode(
      staff.compensation_mode as string | undefined
    );

    if (input.entryType === "daily_wage" && !isDailyWage(compensationMode)) {
      return {
        entry: null,
        entries: [],
        slip: null,
        payrollRecord: null,
        netPayout: 0,
        error: "أجر اليومي مسموح فقط للموظفين على نظام الأجر اليومي",
      };
    }

    if (
      input.entryType !== "daily_wage" &&
      isDailyWage(compensationMode) &&
      !["advance", "deduction", "absence", "bonus"].includes(input.entryType)
    ) {
      return {
        entry: null,
        entries: [],
        slip: null,
        payrollRecord: null,
        netPayout: 0,
        error: "نوع الحركة غير مدعوم لهذا الموظف",
      };
    }

    baseSalary = isDailyWage(compensationMode)
      ? 0
      : Number(staff.base_salary ?? input.baseSalary);
    staffCompensationMode = compensationMode;

    const { data: existingSlip } = await admin
      .from("salary_slips")
      .select("*")
      .eq("clinic_id", input.clinicId)
      .eq("staff_id", staffId)
      .eq("month_year", input.monthYear)
      .maybeSingle();

    if (
      existingSlip &&
      !isDailyWage(compensationMode) &&
      slipIsFullyPaid(existingSlip as SalarySlip, { dailyWage: false })
    ) {
      return {
        entry: null,
        entries: [],
        slip: null,
        payrollRecord: null,
        netPayout: 0,
        error: "قسيمة هذا الموظف مُسلَّمة — لا يمكن إضافة حركات لنفس الشهر",
      };
    }
  } else if (doctorId) {
    const { data: doctor, error: doctorErr } = await admin
      .from("doctors")
      .select("id, salary_amount, payment_type")
      .eq("id", doctorId)
      .eq("clinic_id", input.clinicId)
      .maybeSingle();

    if (doctorErr || !doctor) {
      return {
        entry: null,
        entries: [],
        slip: null,
        payrollRecord: null,
        netPayout: 0,
        error: "الطبيب غير موجود",
      };
    }
    if (doctor.payment_type !== "salary") {
      return {
        entry: null,
        entries: [],
        slip: null,
        payrollRecord: null,
        netPayout: 0,
        error: "هذا الطبيب على نظام النسبة — الحركات من لوحة الرواتب لأطباء الراتب الثابت فقط",
      };
    }

    baseSalary = Number(doctor.salary_amount ?? input.baseSalary);

    const { data: paidSlip } = await admin
      .from("salary_slips")
      .select("id")
      .eq("clinic_id", input.clinicId)
      .eq("doctor_id", doctorId)
      .eq("month_year", input.monthYear)
      .eq("status", "paid")
      .maybeSingle();

    if (paidSlip) {
      return {
        entry: null,
        entries: [],
        slip: null,
        payrollRecord: null,
        netPayout: 0,
        error: "راتب هذا الطبيب مُصرف — لا يمكن إضافة حركات لنفس الشهر",
      };
    }
  } else {
    const { data: assistant, error: asstErr } = await admin
      .from("assistants")
      .select("id, total_salary, compensation_mode")
      .eq("id", assistantId)
      .eq("clinic_id", input.clinicId)
      .maybeSingle();

    if (asstErr || !assistant) {
      return {
        entry: null,
        entries: [],
        slip: null,
        payrollRecord: null,
        netPayout: 0,
        error: "المساعد غير موجود",
      };
    }

    const compensationMode = normalizeAssistantCompensationMode(
      assistant.compensation_mode as string | undefined
    );

    if (
      input.entryType === "daily_wage" &&
      !isDailyWageAssistant(compensationMode)
    ) {
      return {
        entry: null,
        entries: [],
        slip: null,
        payrollRecord: null,
        netPayout: 0,
        error: "أجر اليومي مسموح فقط للمساعدين على نظام الأجر اليومي",
      };
    }

    if (
      input.entryType !== "daily_wage" &&
      isDailyWageAssistant(compensationMode) &&
      !["advance", "deduction", "absence", "bonus"].includes(input.entryType)
    ) {
      return {
        entry: null,
        entries: [],
        slip: null,
        payrollRecord: null,
        netPayout: 0,
        error: "نوع الحركة غير مدعوم لهذا المساعد",
      };
    }

    baseSalary = isDailyWageAssistant(compensationMode)
      ? 0
      : Number(assistant.total_salary ?? input.baseSalary);
    assistantCompensationMode = compensationMode;

    const { data: existingRecord } = await admin
      .from("payroll_records")
      .select("*")
      .eq("clinic_id", input.clinicId)
      .eq("assistant_id", assistantId)
      .eq("month_year", input.monthYear)
      .maybeSingle();

    if (
      existingRecord &&
      !isDailyWageAssistant(compensationMode) &&
      assistantIsFullyPaid(existingRecord as PayrollRecord, { dailyWage: false })
    ) {
      return {
        entry: null,
        entries: [],
        slip: null,
        payrollRecord: null,
        netPayout: 0,
        error: "راتب هذا المساعد مُصرف — لا يمكن إضافة حركات لنفس الشهر",
      };
    }

    assistantPayrollPendingBefore = await fetchAssistantPendingDoctorShare(
      admin,
      input.clinicId,
      assistantId,
      input.monthYear
    );
  }

  const insertRow: Record<string, unknown> = {
    clinic_id: input.clinicId,
    entry_type: input.entryType,
    amount: input.amount,
    entry_date: input.entryDate,
    notes_ar: input.notesAr?.trim() || null,
    created_by: input.createdBy ?? null,
  };
  if (staffId) insertRow.staff_id = staffId;
  if (assistantId) insertRow.assistant_id = assistantId;
  if (doctorId) insertRow.doctor_id = doctorId;

  const { data: entry, error: insertErr } = await admin
    .from("salary_entries")
    .insert(insertRow)
    .select("*")
    .single();

  if (insertErr) {
    return {
      entry: null,
      entries: [],
      slip: null,
      payrollRecord: null,
      netPayout: 0,
      error: mapInsertError(insertErr.message ?? "تعذر الحفظ"),
    };
  }

  const { entries, error: listErr } = await listSalaryEntriesForPersonMonth(
    admin,
    input.clinicId,
    input.monthYear,
    staffId ? { staffId } : doctorId ? { doctorId } : { assistantId }
  );
  if (listErr) {
    return {
      entry: entry as SalaryEntry,
      entries: [],
      slip: null,
      payrollRecord: null,
      netPayout: 0,
      error: listErr,
    };
  }

  const { advances, deductions, bonuses } = summarizeSalaryEntries(entries);
  const netPayout = assistantId && assistantCompensationMode
    ? computeAssistantNetPay(assistantCompensationMode, baseSalary, entries)
        .netPayout
    : staffId && staffCompensationMode
      ? computeStaffNetPay(baseSalary, entries, staffCompensationMode).netPayout
      : calculateSalaryNet(baseSalary, advances, deductions, bonuses);

  if (staffId) {
    const { slip, error: slipErr } = await syncStaffSalarySlipDraft(
      admin,
      input.clinicId,
      staffId,
      input.monthYear
    );
    if (entry) {
      void import("@/lib/notifications/server")
        .then(({ notifyStaffSalaryEntry }) =>
          notifyStaffSalaryEntry({
            clinicId: input.clinicId,
            staffId,
            entryType: input.entryType,
            amount: input.amount,
            monthYear: input.monthYear,
            netPayout,
            notesAr: input.notesAr,
          })
        )
        .catch((err) => {
          console.error("[salary-entry] staff notification failed:", err);
        });
    }
    return {
      entry: entry as SalaryEntry,
      entries,
      slip,
      payrollRecord: null,
      netPayout,
      error: slipErr,
      notice,
    };
  }

  if (doctorId) {
    const { slip, error: slipErr } = await syncDoctorSalarySlipDraft(
      admin,
      input.clinicId,
      doctorId,
      input.monthYear,
      baseSalary
    );
    if (entry) {
      void import("@/lib/notifications/server")
        .then(({ notifyDoctorSalaryEntry }) =>
          notifyDoctorSalaryEntry({
            clinicId: input.clinicId,
            doctorId,
            entryType: input.entryType,
            amount: input.amount,
            monthYear: input.monthYear,
            netPayout,
            notesAr: input.notesAr,
          })
        )
        .catch((err) => {
          console.error("[salary-entry] doctor notification failed:", err);
        });
    }
    return {
      entry: entry as SalaryEntry,
      entries,
      slip,
      payrollRecord: null,
      netPayout,
      error: slipErr,
      notice,
    };
  }

  const { record, error: recordErr } = await syncAssistantPayrollRecord(
    admin,
    input.clinicId,
    assistantId,
    input.monthYear,
    baseSalary
  );

  if (entry) {
    void import("@/lib/notifications/server")
      .then(({ notifyAssistantSalaryEntry }) =>
        notifyAssistantSalaryEntry({
          clinicId: input.clinicId,
          assistantId,
          entryType: input.entryType,
          amount: input.amount,
          monthYear: input.monthYear,
          netPayout,
          notesAr: input.notesAr,
        })
      )
      .catch((err) => {
        console.error("[salary-entry] assistant notification failed:", err);
      });

    notifyDoctorAssistantPayrollChangeIfNeeded(
      admin,
      input.clinicId,
      assistantId,
      input.monthYear,
      assistantPayrollPendingBefore,
      "registered",
      input.entryDate
    );
  }

  return {
    entry: entry as SalaryEntry,
    entries,
    slip: null,
    payrollRecord: record,
    netPayout,
    error: recordErr,
    notice,
  };
}

export type SalaryEntryMutationResult = {
  entries: SalaryEntry[];
  slip: SalarySlip | null;
  payrollRecord: PayrollRecord | null;
  netPayout: number;
  error?: string;
  notice?: string;
};

type LoadedSalaryEntry = SalaryEntry & { clinic_id: string };

function monthYearFromEntryDate(entryDate: string): string {
  return entryDate.slice(0, 7);
}

async function fetchSalaryEntryForMutation(
  admin: SupabaseClient,
  clinicId: string,
  entryId: string
): Promise<{ entry: LoadedSalaryEntry } | { error: string }> {
  const { data, error } = await admin
    .from("salary_entries")
    .select("*")
    .eq("id", entryId)
    .eq("clinic_id", clinicId)
    .maybeSingle();

  if (error) {
    return { error: error.message };
  }
  if (!data) {
    return { error: "الحركة غير موجودة" };
  }

  return { entry: data as LoadedSalaryEntry };
}

async function assertSalaryEntryEditable(
  admin: SupabaseClient,
  clinicId: string,
  entry: LoadedSalaryEntry,
  monthYear: string
): Promise<string | null> {
  if (await isMonthClosed(admin, clinicId, monthYear)) {
    return "الشهر مُغلق — لا يمكن تعديل الحركات";
  }

  const staffId = entry.staff_id?.trim() ?? "";
  const assistantId = entry.assistant_id?.trim() ?? "";
  const doctorId = entry.doctor_id?.trim() ?? "";

  if (assistantId) {
    const base = await loadAssistantPayrollBase(admin, clinicId, assistantId);
    if (base.error) return base.error;

    const { data: record } = await admin
      .from("payroll_records")
      .select("status, paid_total_salary, total_salary")
      .eq("clinic_id", clinicId)
      .eq("assistant_id", assistantId)
      .eq("month_year", monthYear)
      .maybeSingle();

    if (
      record &&
      !isDailyWageAssistant(base.compensationMode) &&
      assistantIsFullyPaid(record as PayrollRecord, { dailyWage: false })
    ) {
      return "راتب هذا المساعد مُصرف — لا يمكن تعديل الحركات";
    }
    return null;
  }

  if (staffId) {
    const { data: staff } = await admin
      .from("staff_members")
      .select("compensation_mode")
      .eq("id", staffId)
      .eq("clinic_id", clinicId)
      .maybeSingle();

    const compensationMode = normalizeCompensationMode(
      staff?.compensation_mode as string | undefined
    );

    const { data: slip } = await admin
      .from("salary_slips")
      .select("status, paid_net_payout, net_payout")
      .eq("clinic_id", clinicId)
      .eq("staff_id", staffId)
      .eq("month_year", monthYear)
      .maybeSingle();

    if (
      slip?.status === "paid" &&
      !isDailyWage(compensationMode) &&
      slipIsFullyPaid(slip as SalarySlip, { dailyWage: false })
    ) {
      return "راتب هذا الموظف مُصرف — لا يمكن تعديل الحركات";
    }
    return null;
  }

  if (doctorId) {
    const { data: slip } = await admin
      .from("salary_slips")
      .select("status, paid_net_payout, net_payout")
      .eq("clinic_id", clinicId)
      .eq("doctor_id", doctorId)
      .eq("month_year", monthYear)
      .maybeSingle();

    if (slip?.status === "paid" && slipIsFullyPaid(slip as SalarySlip)) {
      return "راتب هذا الطبيب مُصرف — لا يمكن تعديل الحركات";
    }
    return null;
  }

  return "حركة غير صالحة";
}

async function assertNetCoversConfirmedPay(
  admin: SupabaseClient,
  clinicId: string,
  monthYear: string,
  entry: LoadedSalaryEntry,
  projectedEntries: SalaryEntry[]
): Promise<string | null> {
  const staffId = entry.staff_id?.trim() ?? "";
  const assistantId = entry.assistant_id?.trim() ?? "";
  const doctorId = entry.doctor_id?.trim() ?? "";

  if (assistantId) {
    const base = await loadAssistantPayrollBase(admin, clinicId, assistantId);
    if (base.error) return base.error;

    const { netPayout: fullNet } = computeAssistantNetPay(
      base.compensationMode,
      base.baseSalary,
      projectedEntries
    );

    const { data: record } = await admin
      .from("payroll_records")
      .select("paid_total_salary")
      .eq("clinic_id", clinicId)
      .eq("assistant_id", assistantId)
      .eq("month_year", monthYear)
      .maybeSingle();

    const paidTotal = assistantPaidTotalSalary(record as PayrollRecord | null);
    if (
      isDailyWageAssistant(base.compensationMode) &&
      paidTotal > FINANCIAL_EPSILON &&
      fullNet + FINANCIAL_EPSILON < paidTotal
    ) {
      return "المبلغ المؤكَّد أكبر من الراتب بعد التعديل — ألغِ تأكيد الصرف أولاً";
    }
    return null;
  }

  if (staffId) {
    const { data: staff } = await admin
      .from("staff_members")
      .select("base_salary, compensation_mode")
      .eq("id", staffId)
      .eq("clinic_id", clinicId)
      .maybeSingle();

    const compensationMode = normalizeCompensationMode(
      staff?.compensation_mode as string | undefined
    );
    const baseSalary = isDailyWage(compensationMode)
      ? 0
      : Number(staff?.base_salary ?? 0);
    const { netPayout: fullNet } = computeStaffNetPay(
      baseSalary,
      projectedEntries,
      compensationMode
    );

    const { data: slip } = await admin
      .from("salary_slips")
      .select("paid_net_payout")
      .eq("clinic_id", clinicId)
      .eq("staff_id", staffId)
      .eq("month_year", monthYear)
      .maybeSingle();

    const paidNet = slipPaidNet(slip as SalarySlip | null);
    if (
      isDailyWage(compensationMode) &&
      paidNet > FINANCIAL_EPSILON &&
      fullNet + FINANCIAL_EPSILON < paidNet
    ) {
      return "المبلغ المؤكَّد أكبر من الراتب بعد التعديل — ألغِ تأكيد الصرف أولاً";
    }
    return null;
  }

  if (doctorId) {
    const { data: doctor } = await admin
      .from("doctors")
      .select("salary_amount")
      .eq("id", doctorId)
      .eq("clinic_id", clinicId)
      .maybeSingle();

    const baseSalary = Number(doctor?.salary_amount ?? 0);
    const { netPayout: fullNet } = computeStaffNetPay(baseSalary, projectedEntries);

    const { data: slip } = await admin
      .from("salary_slips")
      .select("paid_net_payout, status")
      .eq("clinic_id", clinicId)
      .eq("doctor_id", doctorId)
      .eq("month_year", monthYear)
      .maybeSingle();

    const paidNet = slipPaidNet(slip as SalarySlip | null);
    if (
      paidNet > FINANCIAL_EPSILON &&
      fullNet + FINANCIAL_EPSILON < paidNet
    ) {
      return "المبلغ المؤكَّد أكبر من الراتب بعد التعديل — ألغِ تأكيد الصرف أولاً";
    }
    return null;
  }

  return "حركة غير صالحة";
}

async function reconcileAssistantPayrollConfirmedToAccrued(
  admin: SupabaseClient,
  clinicId: string,
  assistantId: string,
  monthYear: string,
  fullNet: number,
  trimHint?: {
    totalSalary: number;
    doctorShare: number;
    clinicShare: number;
    doctorSharePct: number;
    entryId: string;
    entryDate: string;
  }
): Promise<{ error?: string; notice?: string }> {
  const { data: record, error: fetchErr } = await admin
    .from("payroll_records")
    .select("*")
    .eq("clinic_id", clinicId)
    .eq("assistant_id", assistantId)
    .eq("month_year", monthYear)
    .maybeSingle();

  if (fetchErr) return { error: fetchErr.message };
  if (!record) return {};

  const paidTotal = assistantPaidTotalSalary(record as PayrollRecord);
  if (paidTotal <= fullNet + FINANCIAL_EPSILON) return {};

  if (!trimHint || trimHint.totalSalary <= FINANCIAL_EPSILON) {
    return {
      error:
        "المبلغ المؤكَّد أكبر من الراتب بعد التعديل — ألغِ تأكيد الصرف يدوياً",
    };
  }

  const excess = roundMoney(paidTotal - fullNet);
  const trimTotal = roundMoney(Math.min(excess, trimHint.totalSalary));
  if (trimTotal <= FINANCIAL_EPSILON) return {};

  const trimBreakdown = breakdownAssistantSalary({
    total_salary: trimTotal,
    doctor_share_percentage: trimHint.doctorSharePct,
  });

  const paidDoctor = assistantPaidDoctorShare(record as PayrollRecord);
  const paidClinic = assistantPaidClinicShare(record as PayrollRecord);
  const newPaidDoctor = roundMoney(
    Math.max(0, paidDoctor - trimBreakdown.doctorShare)
  );
  const newPaidClinic = roundMoney(
    Math.max(0, paidClinic - trimBreakdown.clinicShare)
  );
  const newPaidTotal = roundMoney(Math.max(0, paidTotal - trimTotal));

  const credit = await creditAssistantPayrollAmounts(
    admin,
    clinicId,
    record as PayrollRecord,
    {
      doctor: trimBreakdown.doctorShare,
      clinic: trimBreakdown.clinicShare,
    },
    `حذف/تعديل أجر ${trimHint.entryDate}`,
    `salary-entry:${trimHint.entryId}`
  );
  if (!credit.ok) {
    return { error: credit.error ?? "تعذر تصحيح خصم الطبيب" };
  }

  const { error: updErr } = await admin
    .from("payroll_records")
    .update({
      paid_doctor_share_amount: newPaidDoctor,
      paid_clinic_share_amount: newPaidClinic,
      paid_total_salary: newPaidTotal,
      paid_at: newPaidTotal > 0 ? (record as PayrollRecord).paid_at : null,
      status: "generated",
    })
    .eq("id", record.id);

  if (updErr) return { error: updErr.message };

  await recomputeAssistantPayrollRecord(
    admin,
    clinicId,
    assistantId,
    monthYear
  );

  return {
    notice:
      "تم تصحيح مبلغ هذه الحركة فقط — تأكيدات الأيام السابقة لم تتأثر",
  };
}

async function reconcileStaffSlipConfirmedToAccrued(
  admin: SupabaseClient,
  clinicId: string,
  staffId: string,
  monthYear: string,
  fullNet: number
): Promise<{ error?: string; notice?: string }> {
  const { data: slip, error: fetchErr } = await admin
    .from("salary_slips")
    .select("*")
    .eq("clinic_id", clinicId)
    .eq("staff_id", staffId)
    .eq("month_year", monthYear)
    .maybeSingle();

  if (fetchErr) return { error: fetchErr.message };
  if (!slip) return {};

  let paidNet = slipPaidNet(slip as SalarySlip);
  if (paidNet <= fullNet + FINANCIAL_EPSILON) return {};

  let reversedAny = false;
  for (let i = 0; i < 30 && paidNet > fullNet + FINANCIAL_EPSILON; i++) {
    const tx = await reverseLastStaffSlipPaidTransaction(
      admin,
      clinicId,
      slip as SalarySlip
    );
    if (!tx.ok) {
      return { error: tx.error ?? "تعذر تعديل تأكيد الصرف تلقائياً" };
    }
    const reversed = roundMoney(tx.reversedAmount ?? 0);
    if (reversed <= 0) break;

    reversedAny = true;
    paidNet = roundMoney(Math.max(0, paidNet - reversed));

    const { error: updErr } = await admin
      .from("salary_slips")
      .update({
        paid_net_payout: paidNet,
        paid_at: paidNet > 0 ? slip.paid_at : null,
        status: "draft",
      })
      .eq("id", slip.id);

    if (updErr) return { error: updErr.message };
    slip.paid_net_payout = paidNet;
  }

  if (paidNet > fullNet + FINANCIAL_EPSILON) {
    return {
      error:
        "المبلغ المؤكَّد أكبر من الراتب بعد التعديل — ألغِ تأكيد الصرف يدوياً",
    };
  }

  if (reversedAny) {
    await syncStaffSalarySlipDraft(admin, clinicId, staffId, monthYear);
    return {
      notice:
        "تم إلغاء تأكيد صرف زائد تلقائياً — يمكنك إعادة التأكيد بعد التعديل",
    };
  }

  return {};
}

/** يضبط الصرف المؤكَّد قبل حذف/تعديل — أجر يومي يُصحَّح مبلغ الحركة فقط */
async function reconcileConfirmedPayBeforeMutation(
  admin: SupabaseClient,
  clinicId: string,
  monthYear: string,
  entry: LoadedSalaryEntry,
  projectedEntries: SalaryEntry[],
  trimHint?: {
    totalSalary: number;
    doctorShare: number;
    clinicShare: number;
    doctorSharePct: number;
  }
): Promise<{ error?: string; notice?: string }> {
  const staffId = entry.staff_id?.trim() ?? "";
  const assistantId = entry.assistant_id?.trim() ?? "";

  if (assistantId) {
    const base = await loadAssistantPayrollBase(admin, clinicId, assistantId);
    if (base.error) return { error: base.error };

    const { netPayout: fullNet } = computeAssistantNetPay(
      base.compensationMode,
      base.baseSalary,
      projectedEntries
    );

    if (isDailyWageAssistant(base.compensationMode)) {
      return reconcileAssistantPayrollConfirmedToAccrued(
        admin,
        clinicId,
        assistantId,
        monthYear,
        fullNet,
        trimHint
          ? {
              ...trimHint,
              entryId: entry.id,
              entryDate: entry.entry_date,
            }
          : undefined
      );
    }

    const err = await assertNetCoversConfirmedPay(
      admin,
      clinicId,
      monthYear,
      entry,
      projectedEntries
    );
    return err ? { error: err } : {};
  }

  if (staffId) {
    const { data: staff } = await admin
      .from("staff_members")
      .select("base_salary, compensation_mode")
      .eq("id", staffId)
      .eq("clinic_id", clinicId)
      .maybeSingle();

    const compensationMode = normalizeCompensationMode(
      staff?.compensation_mode as string | undefined
    );
    const baseSalary = isDailyWage(compensationMode)
      ? 0
      : Number(staff?.base_salary ?? 0);
    const { netPayout: fullNet } = computeStaffNetPay(
      baseSalary,
      projectedEntries,
      compensationMode
    );

    if (isDailyWage(compensationMode)) {
      return reconcileStaffSlipConfirmedToAccrued(
        admin,
        clinicId,
        staffId,
        monthYear,
        fullNet
      );
    }

    const err = await assertNetCoversConfirmedPay(
      admin,
      clinicId,
      monthYear,
      entry,
      projectedEntries
    );
    return err ? { error: err } : {};
  }

  const err = await assertNetCoversConfirmedPay(
    admin,
    clinicId,
    monthYear,
    entry,
    projectedEntries
  );
  return err ? { error: err } : {};
}

async function syncPersonAfterEntryChange(
  admin: SupabaseClient,
  clinicId: string,
  entry: LoadedSalaryEntry,
  monthYear: string
): Promise<SalaryEntryMutationResult> {
  const staffId = entry.staff_id?.trim() ?? "";
  const assistantId = entry.assistant_id?.trim() ?? "";
  const doctorId = entry.doctor_id?.trim() ?? "";

  const personOpts = staffId
    ? { staffId }
    : assistantId
      ? { assistantId }
      : { doctorId };

  const { entries, error: listErr } = await listSalaryEntriesForPersonMonth(
    admin,
    clinicId,
    monthYear,
    personOpts
  );
  if (listErr) {
    return {
      entries: [],
      slip: null,
      payrollRecord: null,
      netPayout: 0,
      error: listErr,
    };
  }

  if (staffId) {
    const { data: staff } = await admin
      .from("staff_members")
      .select("base_salary, compensation_mode")
      .eq("id", staffId)
      .eq("clinic_id", clinicId)
      .maybeSingle();

    const compensationMode = normalizeCompensationMode(
      staff?.compensation_mode as string | undefined
    );
    const baseSalary = isDailyWage(compensationMode)
      ? 0
      : Number(staff?.base_salary ?? 0);
    const { netPayout } = computeStaffNetPay(
      baseSalary,
      entries,
      compensationMode
    );
    const { slip, error } = await syncStaffSalarySlipDraft(
      admin,
      clinicId,
      staffId,
      monthYear
    );
    return { entries, slip, payrollRecord: null, netPayout, error };
  }

  if (doctorId) {
    const { data: doctor } = await admin
      .from("doctors")
      .select("salary_amount")
      .eq("id", doctorId)
      .eq("clinic_id", clinicId)
      .maybeSingle();

    const baseSalary = Number(doctor?.salary_amount ?? 0);
    const { netPayout } = computeStaffNetPay(baseSalary, entries);
    const { slip, error } = await syncDoctorSalarySlipDraft(
      admin,
      clinicId,
      doctorId,
      monthYear,
      baseSalary
    );
    return { entries, slip, payrollRecord: null, netPayout, error };
  }

  const base = await loadAssistantPayrollBase(admin, clinicId, assistantId);
  const { netPayout } = computeAssistantNetPay(
    base.compensationMode,
    base.baseSalary,
    entries
  );
  const { record, error } = await syncAssistantPayrollRecord(
    admin,
    clinicId,
    assistantId,
    monthYear,
    base.baseSalary
  );
  return { entries, slip: null, payrollRecord: record, netPayout, error };
}

/** حذف حركة راتب — يُعاد حساب القسيمة/سجل المساعد */
export async function deleteSalaryEntry(
  admin: SupabaseClient,
  clinicId: string,
  entryId: string
): Promise<SalaryEntryMutationResult & { deleted?: boolean }> {
  const loaded = await fetchSalaryEntryForMutation(admin, clinicId, entryId);
  if ("error" in loaded) {
    return {
      entries: [],
      slip: null,
      payrollRecord: null,
      netPayout: 0,
      error: loaded.error,
    };
  }

  const entry = loaded.entry;
  const monthYear = monthYearFromEntryDate(entry.entry_date);
  const assistantId = entry.assistant_id?.trim() ?? "";
  let assistantPayrollPendingBefore = 0;
  if (assistantId) {
    assistantPayrollPendingBefore = await fetchAssistantPendingDoctorShare(
      admin,
      clinicId,
      assistantId,
      monthYear
    );
  }

  const editableErr = await assertSalaryEntryEditable(
    admin,
    clinicId,
    entry,
    monthYear
  );
  if (editableErr) {
    return {
      entries: [],
      slip: null,
      payrollRecord: null,
      netPayout: 0,
      error: editableErr,
    };
  }

  const { entries: currentEntries, error: listErr } =
    await listSalaryEntriesForPersonMonth(
      admin,
      clinicId,
      monthYear,
      entry.staff_id
        ? { staffId: entry.staff_id }
        : entry.assistant_id
          ? { assistantId: entry.assistant_id! }
          : { doctorId: entry.doctor_id! }
    );
  if (listErr) {
    return {
      entries: [],
      slip: null,
      payrollRecord: null,
      netPayout: 0,
      error: listErr,
    };
  }

  const projected = currentEntries.filter((row) => row.id !== entryId);

  let trimHint:
    | {
        totalSalary: number;
        doctorShare: number;
        clinicShare: number;
        doctorSharePct: number;
      }
    | undefined;
  if (entry.assistant_id) {
    const base = await loadAssistantPayrollBase(
      admin,
      clinicId,
      entry.assistant_id
    );
    if (base.error) {
      return {
        entries: [],
        slip: null,
        payrollRecord: null,
        netPayout: 0,
        error: base.error,
      };
    }
    if (isDailyWageAssistant(base.compensationMode)) {
      const breakdown = breakdownAssistantSalary({
        total_salary: Number(entry.amount),
        doctor_share_percentage: base.doctorSharePercentage,
      });
      trimHint = {
        totalSalary: breakdown.totalSalary,
        doctorShare: breakdown.doctorShare,
        clinicShare: breakdown.clinicShare,
        doctorSharePct: breakdown.doctorSharePercentage,
      };
    }
  }

  const reconcile = await reconcileConfirmedPayBeforeMutation(
    admin,
    clinicId,
    monthYear,
    entry,
    projected,
    trimHint
  );
  if (reconcile.error) {
    return {
      entries: [],
      slip: null,
      payrollRecord: null,
      netPayout: 0,
      error: reconcile.error,
    };
  }

  const { error: deleteErr } = await admin
    .from("salary_entries")
    .delete()
    .eq("id", entryId)
    .eq("clinic_id", clinicId);

  if (deleteErr) {
    return {
      entries: [],
      slip: null,
      payrollRecord: null,
      netPayout: 0,
      error: mapInsertError(deleteErr.message ?? "تعذر الحذف"),
    };
  }

  const synced = await syncPersonAfterEntryChange(
    admin,
    clinicId,
    entry,
    monthYear
  );
  if (assistantId) {
    notifyDoctorAssistantPayrollChangeIfNeeded(
      admin,
      clinicId,
      assistantId,
      monthYear,
      assistantPayrollPendingBefore,
      "removed",
      entry.entry_date
    );
  }
  return { ...synced, deleted: true, notice: reconcile.notice };
}

/** تعديل مبلغ/تاريخ/ملاحظات حركة راتب */
export async function updateSalaryEntry(
  admin: SupabaseClient,
  clinicId: string,
  entryId: string,
  input: {
    amount?: number;
    entryDate?: string;
    notesAr?: string | null;
  }
): Promise<SalaryEntryMutationResult & { entry?: SalaryEntry | null }> {
  const loaded = await fetchSalaryEntryForMutation(admin, clinicId, entryId);
  if ("error" in loaded) {
    return {
      entries: [],
      slip: null,
      payrollRecord: null,
      netPayout: 0,
      error: loaded.error,
    };
  }

  const entry = loaded.entry;
  const oldMonthYear = monthYearFromEntryDate(entry.entry_date);
  const assistantId = entry.assistant_id?.trim() ?? "";
  let assistantPayrollPendingBefore = 0;
  if (assistantId) {
    assistantPayrollPendingBefore = await fetchAssistantPendingDoctorShare(
      admin,
      clinicId,
      assistantId,
      oldMonthYear
    );
  }
  const nextDate = input.entryDate?.trim() || entry.entry_date;
  const nextMonthYear = monthYearFromEntryDate(nextDate);
  const nextAmount =
    input.amount != null ? roundMoney(input.amount) : Number(entry.amount);
  const nextNotes =
    input.notesAr !== undefined ? input.notesAr?.trim() || null : entry.notes_ar;

  if (!Number.isFinite(nextAmount) || nextAmount <= 0) {
    return {
      entries: [],
      slip: null,
      payrollRecord: null,
      netPayout: 0,
      error: "أدخل مبلغاً أكبر من صفر",
    };
  }

  const reasonError = validateSalaryEntryReason(entry.entry_type, nextNotes);
  if (reasonError) {
    return {
      entries: [],
      slip: null,
      payrollRecord: null,
      netPayout: 0,
      error: reasonError,
    };
  }

  for (const monthYear of [oldMonthYear, nextMonthYear]) {
    const editableErr = await assertSalaryEntryEditable(
      admin,
      clinicId,
      entry,
      monthYear
    );
    if (editableErr) {
      return {
        entries: [],
        slip: null,
        payrollRecord: null,
        netPayout: 0,
        error: editableErr,
      };
    }
  }

  const personOpts = entry.staff_id
    ? { staffId: entry.staff_id }
    : entry.assistant_id
      ? { assistantId: entry.assistant_id! }
      : { doctorId: entry.doctor_id! };

  const { entries: currentEntries, error: listErr } =
    await listSalaryEntriesForPersonMonth(
      admin,
      clinicId,
      oldMonthYear,
      personOpts
    );
  if (listErr) {
    return {
      entries: [],
      slip: null,
      payrollRecord: null,
      netPayout: 0,
      error: listErr,
    };
  }

  const projected = currentEntries.map((row) =>
    row.id === entryId
      ? {
          ...row,
          amount: nextAmount,
          entry_date: nextDate,
          notes_ar: nextNotes,
        }
      : row
  );

  let trimHint:
    | {
        totalSalary: number;
        doctorShare: number;
        clinicShare: number;
        doctorSharePct: number;
      }
    | undefined;
  const amountReduced = roundMoney(Number(entry.amount) - nextAmount);
  if (entry.assistant_id && amountReduced > FINANCIAL_EPSILON) {
    const base = await loadAssistantPayrollBase(
      admin,
      clinicId,
      entry.assistant_id
    );
    if (base.error) {
      return {
        entries: [],
        slip: null,
        payrollRecord: null,
        netPayout: 0,
        error: base.error,
      };
    }
    if (isDailyWageAssistant(base.compensationMode)) {
      const breakdown = breakdownAssistantSalary({
        total_salary: amountReduced,
        doctor_share_percentage: base.doctorSharePercentage,
      });
      trimHint = {
        totalSalary: breakdown.totalSalary,
        doctorShare: breakdown.doctorShare,
        clinicShare: breakdown.clinicShare,
        doctorSharePct: breakdown.doctorSharePercentage,
      };
    }
  }

  let mutationNotice: string | undefined;

  if (oldMonthYear === nextMonthYear) {
    const reconcile = await reconcileConfirmedPayBeforeMutation(
      admin,
      clinicId,
      oldMonthYear,
      entry,
      projected,
      trimHint
    );
    if (reconcile.error) {
      return {
        entries: [],
        slip: null,
        payrollRecord: null,
        netPayout: 0,
        error: reconcile.error,
      };
    }
    mutationNotice = reconcile.notice;
  } else {
    const oldProjected = projected.filter(
      (row) => monthYearFromEntryDate(row.entry_date) === oldMonthYear
    );
    const oldReconcile = await reconcileConfirmedPayBeforeMutation(
      admin,
      clinicId,
      oldMonthYear,
      entry,
      oldProjected,
      trimHint
    );
    if (oldReconcile.error) {
      return {
        entries: [],
        slip: null,
        payrollRecord: null,
        netPayout: 0,
        error: oldReconcile.error,
      };
    }
    mutationNotice = oldReconcile.notice;

    const { entries: nextMonthEntries } = await listSalaryEntriesForPersonMonth(
      admin,
      clinicId,
      nextMonthYear,
      personOpts
    );
    const nextProjected = [
      ...nextMonthEntries.filter((row) => row.id !== entryId),
      {
        ...entry,
        amount: nextAmount,
        entry_date: nextDate,
        notes_ar: nextNotes,
      },
    ];
    const nextReconcile = await reconcileConfirmedPayBeforeMutation(
      admin,
      clinicId,
      nextMonthYear,
      entry,
      nextProjected,
      trimHint
    );
    if (nextReconcile.error) {
      return {
        entries: [],
        slip: null,
        payrollRecord: null,
        netPayout: 0,
        error: nextReconcile.error,
      };
    }
    mutationNotice = nextReconcile.notice ?? mutationNotice;
  }

  const { data: updated, error: updateErr } = await admin
    .from("salary_entries")
    .update({
      amount: nextAmount,
      entry_date: nextDate,
      notes_ar: nextNotes,
    })
    .eq("id", entryId)
    .eq("clinic_id", clinicId)
    .select("*")
    .single();

  if (updateErr) {
    return {
      entries: [],
      slip: null,
      payrollRecord: null,
      netPayout: 0,
      error: mapInsertError(updateErr.message ?? "تعذر الحفظ"),
    };
  }

  if (oldMonthYear !== nextMonthYear) {
    await syncPersonAfterEntryChange(admin, clinicId, entry, oldMonthYear);
  }

  const synced = await syncPersonAfterEntryChange(
    admin,
    clinicId,
    entry,
    nextMonthYear
  );

  if (assistantId) {
    notifyDoctorAssistantPayrollChangeIfNeeded(
      admin,
      clinicId,
      assistantId,
      nextMonthYear,
      assistantPayrollPendingBefore,
      "updated",
      nextDate
    );
  }

  return {
    ...synced,
    entry: updated as SalaryEntry,
    notice: mutationNotice,
  };
}
