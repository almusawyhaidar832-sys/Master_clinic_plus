import type { SupabaseClient } from "@supabase/supabase-js";
import { authPortalHeaders } from "@/lib/auth/api-portal";
import { breakdownAssistantSalary } from "@/lib/services/assistant-payroll";
import type { PayrollRecord, SalarySlip } from "@/types";

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
  skipped: number;
  error?: string;
}

export interface GenerateMonthlyPayrollResult {
  ok: boolean;
  assistantCreated: number;
  assistantSkipped: number;
  generalCreated: number;
  generalSkipped: number;
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
      `id, doctor_id, full_name_ar, total_salary, doctor_share_percentage,
       doctor:doctors ( full_name_ar )`
    )
    .eq("clinic_id", clinicId)
    .eq("is_active", true);

  if (asstErr) {
    return { ok: false, created: 0, skipped: 0, error: asstErr.message };
  }

  if (!assistants?.length) {
    return { ok: true, created: 0, skipped: 0 };
  }

  const { data: existing, error: existErr } = await supabase
    .from("payroll_records")
    .select("assistant_id")
    .eq("clinic_id", clinicId)
    .eq("month_year", monthYear);

  if (existErr) {
    return {
      ok: false,
      created: 0,
      skipped: 0,
      error: isMissingPayrollTable(existErr)
        ? MISSING_TABLE_HINT
        : existErr.message,
    };
  }

  const existingIds = new Set(
    (existing ?? []).map((r) => r.assistant_id as string)
  );

  const rows = assistants
    .filter((a) => !existingIds.has(a.id as string))
    .map((a) => {
      const breakdown = breakdownAssistantSalary({
        total_salary: Number(a.total_salary ?? 0),
        doctor_share_percentage: Number(a.doctor_share_percentage ?? 0),
      });

      return {
        clinic_id: clinicId,
        assistant_id: a.id as string,
        doctor_id: a.doctor_id as string,
        month_year: monthYear,
        assistant_name_ar: a.full_name_ar as string,
        doctor_name_ar: relationName(
          a.doctor as { full_name_ar: string } | { full_name_ar: string }[] | null
        ),
        total_salary: breakdown.totalSalary,
        doctor_share_percentage: breakdown.doctorSharePercentage,
        doctor_share_amount: breakdown.doctorShare,
        clinic_share_amount: breakdown.clinicShare,
        status: "generated" as const,
      };
    });

  if (!rows.length) {
    return { ok: true, created: 0, skipped: assistants.length };
  }

  const { error: insertErr } = await supabase
    .from("payroll_records")
    .insert(rows);

  if (insertErr) {
    return {
      ok: false,
      created: 0,
      skipped: existingIds.size,
      error: isMissingPayrollTable(insertErr)
        ? MISSING_TABLE_HINT
        : insertErr.message,
    };
  }

  return {
    ok: true,
    created: rows.length,
    skipped: existingIds.size,
  };
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
    return { ok: false, created: 0, skipped: 0, error: staffErr.message };
  }

  if (!staff?.length) {
    return { ok: true, created: 0, skipped: 0 };
  }

  const { data: existing, error: existErr } = await supabase
    .from("salary_slips")
    .select("staff_id")
    .eq("clinic_id", clinicId)
    .eq("month_year", monthYear);

  if (existErr) {
    return { ok: false, created: 0, skipped: 0, error: existErr.message };
  }

  const existingIds = new Set(
    (existing ?? []).map((r) => r.staff_id as string)
  );

  const rows = staff
    .filter((s) => !existingIds.has(s.id as string))
    .map((s) => {
      const base = Number(s.base_salary ?? 0);
      return {
        clinic_id: clinicId,
        staff_id: s.id as string,
        month_year: monthYear,
        base_salary: base,
        total_advances: 0,
        total_deductions: 0,
        net_payout: base,
        status: "draft" as const,
      };
    });

  if (!rows.length) {
    return { ok: true, created: 0, skipped: staff.length };
  }

  const { error: insertErr } = await supabase.from("salary_slips").insert(rows);

  if (insertErr) {
    return {
      ok: false,
      created: 0,
      skipped: existingIds.size,
      error: insertErr.message,
    };
  }

  return {
    ok: true,
    created: rows.length,
    skipped: existingIds.size,
  };
}

/** توليد رواتب الشهر — مساعدون (تقسيم) + موظفو خدمات (مصاريف عيادة فقط) */
export async function generateMonthlyPayroll(
  supabase: SupabaseClient,
  clinicId: string,
  monthYear: string
): Promise<GenerateMonthlyPayrollResult> {
  const [assistantRes, generalRes] = await Promise.all([
    generateMonthlyAssistantPayroll(supabase, clinicId, monthYear),
    generateMonthlyGeneralStaffPayroll(supabase, clinicId, monthYear),
  ]);

  if (!assistantRes.ok) {
    return {
      ok: false,
      assistantCreated: 0,
      assistantSkipped: 0,
      generalCreated: 0,
      generalSkipped: 0,
      error: assistantRes.error,
    };
  }
  if (!generalRes.ok) {
    return {
      ok: false,
      assistantCreated: assistantRes.created,
      assistantSkipped: assistantRes.skipped,
      generalCreated: 0,
      generalSkipped: 0,
      error: generalRes.error,
    };
  }

  return {
    ok: true,
    assistantCreated: assistantRes.created,
    assistantSkipped: assistantRes.skipped,
    generalCreated: generalRes.created,
    generalSkipped: generalRes.skipped,
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
      assistantSkipped: 0,
      generalCreated: 0,
      generalSkipped: 0,
      error: (json as { error?: string }).error ?? "تعذر توليد الرواتب",
    };
  }
  return {
    ok: true,
    assistantCreated: json.assistantCreated ?? 0,
    assistantSkipped: json.assistantSkipped ?? 0,
    generalCreated: json.generalCreated ?? 0,
    generalSkipped: json.generalSkipped ?? 0,
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
