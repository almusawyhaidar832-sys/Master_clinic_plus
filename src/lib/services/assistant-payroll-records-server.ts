import type { SupabaseClient } from "@supabase/supabase-js";
import {
  generateMonthlyPayroll,
  type GenerateMonthlyPayrollResult,
} from "@/lib/services/assistant-payroll-records";
import { ensureAccountantStaffRows } from "@/lib/services/accountant-payroll-sync";
import type { PayrollRecord, SalarySlip } from "@/types";

/** توليد رواتب الشهر لجميع العاملين — عبر service_role */
export async function generateMonthlyPayrollAdmin(
  admin: SupabaseClient,
  clinicId: string,
  monthYear: string
): Promise<GenerateMonthlyPayrollResult> {
  await ensureAccountantStaffRows(admin, clinicId);
  return generateMonthlyPayroll(admin, clinicId, monthYear);
}

export async function fetchPayrollMonthAdmin(
  admin: SupabaseClient,
  clinicId: string,
  monthYear: string
): Promise<{ records: PayrollRecord[]; slips: SalarySlip[] }> {
  const [recordsRes, slipsRes] = await Promise.all([
    admin
      .from("payroll_records")
      .select("*")
      .eq("clinic_id", clinicId)
      .eq("month_year", monthYear)
      .order("assistant_name_ar"),
    admin
      .from("salary_slips")
      .select("*, staff:staff_members!staff_id(full_name_ar, job_title_ar, profile_id)")
      .eq("clinic_id", clinicId)
      .eq("month_year", monthYear)
      .order("created_at", { ascending: false }),
  ]);

  return {
    records: (recordsRes.data as PayrollRecord[]) ?? [],
    slips: (slipsRes.data as SalarySlip[]) ?? [],
  };
}
