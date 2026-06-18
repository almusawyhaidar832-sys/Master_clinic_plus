import type { SupabaseClient } from "@supabase/supabase-js";
import { authPortalHeaders } from "@/lib/auth/api-portal";
import { breakdownAssistantSalary } from "@/lib/services/assistant-payroll";
import {
  computeAssistantNetPay,
  computeStaffNetPay,
} from "@/lib/services/salary-entry-math";
import {
  isDailyWageAssistant,
  normalizeAssistantCompensationMode,
} from "@/lib/services/assistant-compensation";
import { monthDateRange } from "@/lib/utils";
import type { PayrollRecord, SalaryEntry, SalarySlip } from "@/types";

function relationName(
  rel: { full_name_ar: string } | { full_name_ar: string }[] | null | undefined
): string | null {
  if (!rel) return null;
  return Array.isArray(rel) ? rel[0]?.full_name_ar ?? null : rel.full_name_ar;
}

const MISSING_TABLE_HINT =
  "شغّل في Supabase: supabase/scripts/06-assistant-payroll-records.sql";

function isMissingPayrollTable(error: { message?: string; code?: string } | null) {
  if (!error) return false;
  const msg = error.message ?? "";
  return (
    error.code === "PGRST205" ||
    msg.includes("payroll_records") ||
    msg.includes("schema cache")
  );
}

export interface GeneratePayrollResult {
  ok: boolean;
  created: number;
  updated: number;
  skipped: number;
  error?: string;
}

async function listStaffSalaryEntriesForMonth(
  supabase: SupabaseClient,
  clinicId: string,
  staffId: string,
  monthYear: string
): Promise<SalaryEntry[]> {
  const { from, to } = monthDateRange(monthYear);
  const { data } = await supabase
    .from("salary_entries")
    .select("entry_type, amount")
    .eq("clinic_id", clinicId)
    .eq("staff_id", staffId)
    .gte("entry_date", from)
    .lte("entry_date", to);
  return (data as SalaryEntry[]) ?? [];
}

async function listDoctorSalaryEntriesForMonth(
  supabase: SupabaseClient,
  clinicId: string,
  doctorId: string,
  monthYear: string
): Promise<SalaryEntry[]> {
  const { from, to } = monthDateRange(monthYear);
  const { data } = await supabase
    .from("salary_entries")
    .select("entry_type, amount")
    .eq("clinic_id", clinicId)
    .eq("doctor_id", doctorId)
    .gte("entry_date", from)
    .lte("entry_date", to);
  return (data as SalaryEntry[]) ?? [];
}

async function listAssistantSalaryEntriesForMonth(
  supabase: SupabaseClient,
  clinicId: string,
  assistantId: string,
  monthYear: string
): Promise<SalaryEntry[]> {
  const { from, to } = monthDateRange(monthYear);
  const { data } = await supabase
    .from("salary_entries")
    .select("entry_type, amount")
    .eq("clinic_id", clinicId)
    .eq("assistant_id", assistantId)
    .gte("entry_date", from)
    .lte("entry_date", to);
  return (data as SalaryEntry[]) ?? [];
}

export interface GenerateMonthlyPayrollResult {
  ok: boolean;
  assistantCreated: number;
  assistantUpdated: number;
  assistantSkipped: number;
  generalCreated: number;
  generalUpdated: number;
  generalSkipped: number;
  doctorSalaryCreated: number;
  doctorSalaryUpdated: number;
  doctorSalarySkipped: number;
  error?: string;
}

export async function fetchPayrollRecordsForMonth(
  supabase: SupabaseClient,
  clinicId: string,
  monthYear: string
): Promise<PayrollRecord[]> {
  const { data, error } = await supabase
    .from("payroll_records")
    .select("*")
    .eq("clinic_id", clinicId)
    .eq("month_year", monthYear)
    .order("assistant_name_ar");

  if (error) {
    if (isMissingPayrollTable(error)) return [];
    throw new Error(error.message);
  }

  return (data as PayrollRecord[]) ?? [];
}

export async function countActiveAssistantsForPayroll(
  supabase: SupabaseClient,
  clinicId: string
): Promise<number> {
  const { count, error } = await supabase
    .from("assistants")
    .select("id", { count: "exact", head: true })
    .eq("clinic_id", clinicId)
    .eq("is_active", true);

  if (error) return 0;
  return count ?? 0;
}

/** مساعدو الأطباء — تقسيم حصة الطبيب + حصة العيادة */
export async function generateMonthlyAssistantPayroll(
  supabase: SupabaseClient,
  clinicId: string,
  monthYear: string
): Promise<GeneratePayrollResult> {
  const { data: assistants, error: asstErr } = await supabase
    .from("assistants")
    .select(
      `id, doctor_id, full_name_ar, total_salary, doctor_share_percentage, compensation_mode,
       doctor:doctors ( full_name_ar )`
    )
    .eq("clinic_id", clinicId)
    .eq("is_active", true);

  if (asstErr) {
    return { ok: false, created: 0, updated: 0, skipped: 0, error: asstErr.message };
  }

  if (!assistants?.length) {
    return { ok: true, created: 0, updated: 0, skipped: 0 };
  }

  const { data: existing, error: existErr } = await supabase
    .from("payroll_records")
    .select("id, assistant_id, status")
    .eq("clinic_id", clinicId)
    .eq("month_year", monthYear);

  if (existErr) {
    return {
      ok: false,
      created: 0,
      updated: 0,
      skipped: 0,
      error: isMissingPayrollTable(existErr)
        ? MISSING_TABLE_HINT
        : existErr.message,
    };
  }

  const existingByAssistant = new Map(
    (existing ?? []).map((r) => [
      r.assistant_id as string,
      { id: r.id as string, status: r.status as string },
    ])
  );

  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const a of assistants) {
    const assistantId = a.id as string;
    const existingRecord = existingByAssistant.get(assistantId);

    if (existingRecord?.status === "paid") {
      skipped += 1;
      continue;
    }

    const entries = await listAssistantSalaryEntriesForMonth(
      supabase,
      clinicId,
      assistantId,
      monthYear
    );
    const compensationMode = normalizeAssistantCompensationMode(
      a.compensation_mode as string | undefined
    );
    const baseSalary = isDailyWageAssistant(compensationMode)
      ? 0
      : Number(a.total_salary ?? 0);
    const { netPayout } = computeAssistantNetPay(
      compensationMode,
      baseSalary,
      entries
    );
    const breakdown = breakdownAssistantSalary({
      total_salary: netPayout,
      doctor_share_percentage: Number(a.doctor_share_percentage ?? 0),
    });

    const payload = {
      clinic_id: clinicId,
      assistant_id: assistantId,
      doctor_id: a.doctor_id as string,
      month_year: monthYear,
      assistant_name_ar: a.full_name_ar as string,
      doctor_name_ar: relationName(
        a.doctor as { full_name_ar: string } | { full_name_ar: string }[] | null
      ),
      total_salary: netPayout,
      doctor_share_percentage: breakdown.doctorSharePercentage,
      doctor_share_amount: breakdown.doctorShare,
      clinic_share_amount: breakdown.clinicShare,
      status: "generated" as const,
    };

    if (existingRecord) {
      const { error: updateErr } = await supabase
        .from("payroll_records")
        .update({
          assistant_name_ar: payload.assistant_name_ar,
          doctor_name_ar: payload.doctor_name_ar,
          total_salary: payload.total_salary,
          doctor_share_percentage: payload.doctor_share_percentage,
          doctor_share_amount: payload.doctor_share_amount,
          clinic_share_amount: payload.clinic_share_amount,
          status: "generated",
        })
        .eq("id", existingRecord.id);

      if (updateErr) {
        return {
          ok: false,
          created,
          updated,
          skipped,
          error: isMissingPayrollTable(updateErr)
            ? MISSING_TABLE_HINT
            : updateErr.message,
        };
      }
      updated += 1;
    } else {
      const { error: insertErr } = await supabase
        .from("payroll_records")
        .insert(payload);

      if (insertErr) {
        return {
          ok: false,
          created,
          updated,
          skipped,
          error: isMissingPayrollTable(insertErr)
            ? MISSING_TABLE_HINT
            : insertErr.message,
        };
      }
      created += 1;
    }
  }

  return { ok: true, created, updated, skipped };
}

/**
 * موظفو الخدمات العامون — الراتب كاملاً مصاريف تشغيل العيادة (لا خصم من الأطباء).
 * يُنشئ قسيمة راتب (salary_slip) لكل موظف نشط.
 */
export async function generateMonthlyGeneralStaffPayroll(
  supabase: SupabaseClient,
  clinicId: string,
  monthYear: string
): Promise<GeneratePayrollResult> {
  const { data: staff, error: staffErr } = await supabase
    .from("staff_members")
    .select("id, full_name_ar, base_salary")
    .eq("clinic_id", clinicId)
    .eq("is_active", true);

  if (staffErr) {
    return { ok: false, created: 0, updated: 0, skipped: 0, error: staffErr.message };
  }

  if (!staff?.length) {
    return { ok: true, created: 0, updated: 0, skipped: 0 };
  }

  const { data: existingSlips, error: existErr } = await supabase
    .from("salary_slips")
    .select("id, staff_id, status")
    .eq("clinic_id", clinicId)
    .eq("month_year", monthYear);

  if (existErr) {
    return { ok: false, created: 0, updated: 0, skipped: 0, error: existErr.message };
  }

  const slipByStaff = new Map(
    (existingSlips ?? [])
      .filter((r) => r.staff_id)
      .map((r) => [r.staff_id as string, r])
  );

  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const member of staff) {
    const staffId = member.id as string;
    const baseSalary = Number(member.base_salary ?? 0);
    const entries = await listStaffSalaryEntriesForMonth(
      supabase,
      clinicId,
      staffId,
      monthYear
    );
    const { advances, deductions, netPayout } = computeStaffNetPay(
      baseSalary,
      entries
    );

    const existing = slipByStaff.get(staffId);
    if (existing?.status === "paid") {
      skipped += 1;
      continue;
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

    if (existing) {
      const { error: updateErr } = await supabase
        .from("salary_slips")
        .update({
          base_salary: payload.base_salary,
          total_advances: payload.total_advances,
          total_deductions: payload.total_deductions,
          net_payout: payload.net_payout,
          status: "draft",
        })
        .eq("id", existing.id);

      if (updateErr) {
        return {
          ok: false,
          created,
          updated,
          skipped,
          error: updateErr.message,
        };
      }
      updated += 1;
    } else {
      const { error: insertErr } = await supabase
        .from("salary_slips")
        .insert(payload);

      if (insertErr) {
        return {
          ok: false,
          created,
          updated,
          skipped,
          error: insertErr.message,
        };
      }
      created += 1;
    }
  }

  return { ok: true, created, updated, skipped };
}

/** أطباء الراتب الثابت — قسائم شهرية مثل موظفي العيادة */
export async function generateMonthlyDoctorSalaryPayroll(
  supabase: SupabaseClient,
  clinicId: string,
  monthYear: string
): Promise<GeneratePayrollResult> {
  const { data: doctors, error: docErr } = await supabase
    .from("doctors")
    .select("id, full_name_ar, salary_amount")
    .eq("clinic_id", clinicId)
    .eq("is_active", true)
    .eq("payment_type", "salary");

  if (docErr) {
    return { ok: false, created: 0, updated: 0, skipped: 0, error: docErr.message };
  }

  if (!doctors?.length) {
    return { ok: true, created: 0, updated: 0, skipped: 0 };
  }

  const { data: existingSlips, error: existErr } = await supabase
    .from("salary_slips")
    .select("id, doctor_id, status")
    .eq("clinic_id", clinicId)
    .eq("month_year", monthYear)
    .not("doctor_id", "is", null);

  if (existErr) {
    return { ok: false, created: 0, updated: 0, skipped: 0, error: existErr.message };
  }

  const slipByDoctor = new Map(
    (existingSlips ?? []).map((r) => [r.doctor_id as string, r])
  );

  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const doc of doctors) {
    const doctorId = doc.id as string;
    const baseSalary = Number(doc.salary_amount ?? 0);
    const entries = await listDoctorSalaryEntriesForMonth(
      supabase,
      clinicId,
      doctorId,
      monthYear
    );
    const { advances, deductions, netPayout } = computeStaffNetPay(
      baseSalary,
      entries
    );

    const existing = slipByDoctor.get(doctorId);
    if (existing?.status === "paid") {
      skipped += 1;
      continue;
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

    if (existing) {
      const { error: updateErr } = await supabase
        .from("salary_slips")
        .update({
          base_salary: payload.base_salary,
          total_advances: payload.total_advances,
          total_deductions: payload.total_deductions,
          net_payout: payload.net_payout,
          status: "draft",
        })
        .eq("id", existing.id);

      if (updateErr) {
        return {
          ok: false,
          created,
          updated,
          skipped,
          error: updateErr.message,
        };
      }
      updated += 1;
    } else {
      const { error: insertErr } = await supabase
        .from("salary_slips")
        .insert(payload);

      if (insertErr) {
        return {
          ok: false,
          created,
          updated,
          skipped,
          error: insertErr.message,
        };
      }
      created += 1;
    }
  }

  return { ok: true, created, updated, skipped };
}

/** توليد رواتب الشهر — مساعدون (تقسيم) + موظفو خدمات (مصاريف عيادة فقط) */
export async function generateMonthlyPayroll(
  supabase: SupabaseClient,
  clinicId: string,
  monthYear: string
): Promise<GenerateMonthlyPayrollResult> {
  const [assistantRes, generalRes, doctorSalaryRes] = await Promise.all([
    generateMonthlyAssistantPayroll(supabase, clinicId, monthYear),
    generateMonthlyGeneralStaffPayroll(supabase, clinicId, monthYear),
    generateMonthlyDoctorSalaryPayroll(supabase, clinicId, monthYear),
  ]);

  if (!assistantRes.ok) {
    return {
      ok: false,
      assistantCreated: 0,
      assistantUpdated: 0,
      assistantSkipped: 0,
      generalCreated: 0,
      generalUpdated: 0,
      generalSkipped: 0,
      doctorSalaryCreated: 0,
      doctorSalaryUpdated: 0,
      doctorSalarySkipped: 0,
      error: assistantRes.error,
    };
  }
  if (!generalRes.ok) {
    return {
      ok: false,
      assistantCreated: assistantRes.created,
      assistantUpdated: assistantRes.updated,
      assistantSkipped: assistantRes.skipped,
      generalCreated: 0,
      generalUpdated: 0,
      generalSkipped: 0,
      doctorSalaryCreated: 0,
      doctorSalaryUpdated: 0,
      doctorSalarySkipped: 0,
      error: generalRes.error,
    };
  }
  if (!doctorSalaryRes.ok) {
    return {
      ok: false,
      assistantCreated: assistantRes.created,
      assistantUpdated: assistantRes.updated,
      assistantSkipped: assistantRes.skipped,
      generalCreated: generalRes.created,
      generalUpdated: generalRes.updated,
      generalSkipped: generalRes.skipped,
      doctorSalaryCreated: 0,
      doctorSalaryUpdated: 0,
      doctorSalarySkipped: 0,
      error: doctorSalaryRes.error,
    };
  }

  return {
    ok: true,
    assistantCreated: assistantRes.created,
    assistantUpdated: assistantRes.updated,
    assistantSkipped: assistantRes.skipped,
    generalCreated: generalRes.created,
    generalUpdated: generalRes.updated,
    generalSkipped: generalRes.skipped,
    doctorSalaryCreated: doctorSalaryRes.created,
    doctorSalaryUpdated: doctorSalaryRes.updated,
    doctorSalarySkipped: doctorSalaryRes.skipped,
  };
}

/** توليد رواتب الشهر عبر API (يتجاوز RLS) */
export async function generateMonthlyPayrollViaApi(
  monthYear: string
): Promise<GenerateMonthlyPayrollResult & { totalCreated?: number }> {
  const res = await fetch("/api/payroll/generate", {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...authPortalHeaders("accountant"),
    },
    body: JSON.stringify({ month_year: monthYear }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    return {
      ok: false,
      assistantCreated: 0,
      assistantUpdated: 0,
      assistantSkipped: 0,
      generalCreated: 0,
      generalUpdated: 0,
      generalSkipped: 0,
      doctorSalaryCreated: 0,
      doctorSalaryUpdated: 0,
      doctorSalarySkipped: 0,
      error: (json as { error?: string }).error ?? "تعذر توليد الرواتب",
    };
  }
  return {
    ok: true,
    assistantCreated: json.assistantCreated ?? 0,
    assistantUpdated: json.assistantUpdated ?? 0,
    assistantSkipped: json.assistantSkipped ?? 0,
    generalCreated: json.generalCreated ?? 0,
    generalUpdated: json.generalUpdated ?? 0,
    generalSkipped: json.generalSkipped ?? 0,
    doctorSalaryCreated: json.doctorSalaryCreated ?? 0,
    doctorSalaryUpdated: json.doctorSalaryUpdated ?? 0,
    doctorSalarySkipped: json.doctorSalarySkipped ?? 0,
    totalCreated: json.totalCreated ?? 0,
  };
}

/** جلب سجلات الشهر عبر API */
/** تأكيد صرف راتب عبر API — حركة مالية + تحديث الربح */
export async function confirmPayrollViaApi(
  kind: "slip" | "assistant",
  id: string
): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch("/api/payroll/confirm", {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...authPortalHeaders("accountant"),
    },
    body: JSON.stringify({ kind, id }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    return {
      ok: false,
      error: (json as { error?: string }).error ?? "تعذر تأكيد الصرف",
    };
  }
  return { ok: true };
}

export async function fetchPayrollMonthViaApi(monthYear: string): Promise<{
  records: PayrollRecord[];
  slips: SalarySlip[];
}> {
  const res = await fetch(
    `/api/payroll/month?month_year=${encodeURIComponent(monthYear)}`,
    {
      credentials: "include",
      headers: authPortalHeaders("accountant"),
    }
  );
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      (json as { error?: string }).error ?? "تعذر جلب رواتب الشهر"
    );
  }
  return {
    records: (json as { records?: PayrollRecord[] }).records ?? [],
    slips: (json as { slips?: SalarySlip[] }).slips ?? [],
  };
}

export async function fetchPayrollRecordsForDoctorMonth(
  supabase: SupabaseClient,
  doctorId: string,
  monthYear: string
): Promise<PayrollRecord[]> {
  const { data, error } = await supabase
    .from("payroll_records")
    .select("*")
    .eq("doctor_id", doctorId)
    .eq("month_year", monthYear)
    .order("assistant_name_ar");

  if (error) {
    if (isMissingPayrollTable(error)) return [];
    return [];
  }

  return (data as PayrollRecord[]) ?? [];
}
