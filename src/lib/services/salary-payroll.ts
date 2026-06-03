import type { SupabaseClient } from "@supabase/supabase-js";
import {
  currentMonthYear,
  maxMonthYear,
  nextMonthYear,
} from "@/lib/utils";

const CLOSURES_TABLE_HINT =
  "شغّل في Supabase SQL Editor ملف: supabase/scripts/fix-salary-month-closures.sql ثم أعد تحميل الصفحة";

function isMissingClosuresTable(error: { message?: string; code?: string } | null) {
  if (!error) return false;
  const msg = error.message ?? "";
  return (
    error.code === "PGRST205" ||
    msg.includes("salary_month_closures") ||
    msg.includes("schema cache")
  );
}

/**
 * شهر العمل على لوحة الرواتب بعد آخر تصفير (أو الشهر التقويمي إن كان أحدث).
 */
export async function fetchActivePayrollMonth(
  supabase: SupabaseClient,
  clinicId: string
): Promise<string> {
  const calendar = currentMonthYear();

  const { data, error } = await supabase
    .from("salary_month_closures")
    .select("month_year")
    .eq("clinic_id", clinicId)
    .order("month_year", { ascending: false })
    .limit(1);

  if (error) {
    if (isMissingClosuresTable(error)) return calendar;
    return calendar;
  }
  if (!data?.length) return calendar;

  const afterClose = nextMonthYear(data[0].month_year as string);
  return maxMonthYear(afterClose, calendar);
}

/** أشهر أُغلقت بتصفير اللوحة — للوحة الرواتب فقط (لا تؤثر على خصم الربح) */
export async function fetchClosedPayrollMonths(
  supabase: SupabaseClient,
  clinicId: string
): Promise<Set<string>> {
  const { data, error } = await supabase
    .from("salary_month_closures")
    .select("month_year")
    .eq("clinic_id", clinicId);

  if (error && isMissingClosuresTable(error)) return new Set();
  if (error || !data?.length) return new Set();
  return new Set(data.map((r) => r.month_year as string));
}

export async function isMonthClosed(
  supabase: SupabaseClient,
  clinicId: string,
  monthYear: string
): Promise<boolean> {
  const { data, error } = await supabase
    .from("salary_month_closures")
    .select("id")
    .eq("clinic_id", clinicId)
    .eq("month_year", monthYear)
    .maybeSingle();
  if (error && isMissingClosuresTable(error)) return false;
  return Boolean(data);
}

export interface ResetPayrollResult {
  ok: boolean;
  error?: string;
  closedMonth?: string;
  nextMonth?: string;
}

/**
 * تصفير لوحة الرواتب: إغلاق شهر العمل والانتقال للتالي.
 * لا يحذف قسائم «مدفوعة» ولا يغيّر خصم الربح في لوحة التحكم.
 */
export async function resetPayrollBoard(
  supabase: SupabaseClient,
  clinicId: string,
  monthYear: string
): Promise<ResetPayrollResult> {
  const already = await isMonthClosed(supabase, clinicId, monthYear);
  if (already) {
    return {
      ok: false,
      error: `شهر ${monthYear} مُصفَّر مسبقاً`,
    };
  }

  const { error: closeErr } = await supabase.from("salary_month_closures").insert({
    clinic_id: clinicId,
    month_year: monthYear,
  });

  if (closeErr) {
    return {
      ok: false,
      error: isMissingClosuresTable(closeErr)
        ? CLOSURES_TABLE_HINT
        : closeErr.message,
    };
  }

  // مسودات فقط — المدفوعة تبقى للتقارير والربح
  await supabase
    .from("salary_slips")
    .delete()
    .eq("clinic_id", clinicId)
    .eq("month_year", monthYear)
    .eq("status", "draft");

  const next = nextMonthYear(monthYear);
  return { ok: true, closedMonth: monthYear, nextMonth: next };
}
