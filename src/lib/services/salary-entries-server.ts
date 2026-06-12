import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { breakdownAssistantSalary } from "@/lib/services/assistant-payroll";
import {
  computeStaffNetPay,
  summarizeSalaryEntries as summarizeEntriesMath,
} from "@/lib/services/salary-entry-math";
import { validateSalaryEntryReason } from "@/lib/services/salary-entry-reason";
import { calculateSalaryNet, monthDateRange } from "@/lib/utils";
import type { PayrollRecord, SalaryEntry, SalaryEntryType, SalarySlip } from "@/types";

const ENTRY_TYPES: SalaryEntryType[] = [
  "advance",
  "deduction",
  "absence",
  "bonus",
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
    return "نوع الحركة غير مدعوم — شغّل supabase/scripts/35-salary-entry-bonus.sql في Supabase";
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
  monthYear: string,
  baseSalary: number
): Promise<{ slip: SalarySlip | null; error?: string }> {
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
    entries
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

  if (existing?.status === "paid") {
    return { slip: existing as SalarySlip };
  }

  const payload = {
    clinic_id: clinicId,
    staff_id: staffId,
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
  error?: string;
}> {
  const { data, error } = await admin
    .from("assistants")
    .select("total_salary, doctor_share_percentage")
    .eq("id", assistantId)
    .eq("clinic_id", clinicId)
    .maybeSingle();

  if (error) {
    return { baseSalary: 0, doctorSharePercentage: 0, error: error.message };
  }
  if (!data) {
    return { baseSalary: 0, doctorSharePercentage: 0, error: "المساعد غير موجود" };
  }

  return {
    baseSalary: Number(data.total_salary ?? 0),
    doctorSharePercentage: Number(data.doctor_share_percentage ?? 0),
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
  const netTotal = calculateSalaryNet(
    base.baseSalary,
    advances,
    deductions,
    bonuses
  );

  const { data: existing, error: fetchErr } = await admin
    .from("payroll_records")
    .select("*")
    .eq("clinic_id", clinicId)
    .eq("assistant_id", assistantId)
    .eq("month_year", monthYear)
    .maybeSingle();

  if (fetchErr) {
    return { record: null, netTotal, error: fetchErr.message };
  }

  if (!existing) {
    return {
      record: null,
      netTotal,
      error: "لا يوجد راتب مُولَّد لهذا المساعد — اضغط «توليد رواتب الشهر» أولاً",
    };
  }

  if (existing.status === "paid") {
    return { record: existing as PayrollRecord, netTotal };
  }

  const breakdown = breakdownAssistantSalary({
    total_salary: netTotal,
    doctor_share_percentage: base.doctorSharePercentage,
  });

  const { data, error } = await admin
    .from("payroll_records")
    .update({
      total_salary: netTotal,
      doctor_share_percentage: breakdown.doctorSharePercentage,
      doctor_share_amount: breakdown.doctorShare,
      clinic_share_amount: breakdown.clinicShare,
    })
    .eq("id", existing.id)
    .select("*")
    .single();

  if (error) {
    return { record: null, netTotal, error: error.message };
  }

  return { record: data as PayrollRecord, netTotal };
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
      `id, doctor_id, full_name_ar, total_salary, doctor_share_percentage,
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

  const { entries, error: listErr } = await listSalaryEntriesForPersonMonth(
    admin,
    clinicId,
    monthYear,
    { assistantId }
  );
  if (listErr) {
    return { record: null, error: listErr };
  }

  const baseSalary = Number(assistant.total_salary ?? 0);
  const { advances, deductions, bonuses } = summarizeSalaryEntries(entries);
  const netPayout = calculateSalaryNet(
    baseSalary,
    advances,
    deductions,
    bonuses
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
    .select("base_salary")
    .eq("id", staffId)
    .eq("clinic_id", clinicId)
    .maybeSingle();

  if (staffErr) {
    return { updated: 0, error: staffErr.message };
  }
  if (!staff) {
    return { updated: 0, error: "الموظف غير موجود" };
  }

  const baseSalary = Number(staff.base_salary ?? 0);

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
}> {
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

  if (staffId) {
    const { data: staff, error: staffErr } = await admin
      .from("staff_members")
      .select("id, base_salary")
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

    baseSalary = Number(staff.base_salary ?? input.baseSalary);

    const { data: paidSlip } = await admin
      .from("salary_slips")
      .select("id")
      .eq("clinic_id", input.clinicId)
      .eq("staff_id", staffId)
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
      .select("id, total_salary")
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

    baseSalary = Number(assistant.total_salary ?? input.baseSalary);

    const { data: paidRecord } = await admin
      .from("payroll_records")
      .select("id")
      .eq("clinic_id", input.clinicId)
      .eq("assistant_id", assistantId)
      .eq("month_year", input.monthYear)
      .eq("status", "paid")
      .maybeSingle();

    if (paidRecord) {
      return {
        entry: null,
        entries: [],
        slip: null,
        payrollRecord: null,
        netPayout: 0,
        error: "راتب هذا المساعد مُصرف — لا يمكن إضافة حركات لنفس الشهر",
      };
    }
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
  const netPayout = calculateSalaryNet(baseSalary, advances, deductions, bonuses);

  if (staffId) {
    const { slip, error: slipErr } = await syncStaffSalarySlipDraft(
      admin,
      input.clinicId,
      staffId,
      input.monthYear,
      baseSalary
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
  }

  return {
    entry: entry as SalaryEntry,
    entries,
    slip: null,
    payrollRecord: record,
    netPayout,
    error: recordErr,
  };
}
