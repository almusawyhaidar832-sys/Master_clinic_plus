import type { SupabaseClient } from "@supabase/supabase-js";
import { ensureAccountantStaffRows } from "@/lib/services/accountant-payroll-sync";
import type { PayrollPerson } from "@/lib/services/payroll-persons";

function mapStaffRow(s: {
  id: string;
  full_name_ar: string;
  job_title_ar: string | null;
  base_salary: number | null;
  profile_id?: string | null;
}): PayrollPerson {
  const isAccountant = Boolean(s.profile_id);
  const job = (s.job_title_ar as string) || (isAccountant ? "محاسب" : "موظف خدمات");
  return {
    id: s.id as string,
    name: s.full_name_ar as string,
    role: job,
    category: isAccountant ? "accountant" : "general",
    full_name_ar: s.full_name_ar as string,
    job_title_ar: job,
    base_salary: Number(s.base_salary ?? 0),
    profile_id: s.profile_id ?? null,
    is_active: true,
  };
}

/** جلب قائمة الرواتب عبر service_role — يتجاوز قيود RLS على القراءة */
export async function fetchActivePayrollPersonsAdmin(
  admin: SupabaseClient,
  clinicId: string
): Promise<PayrollPerson[]> {
  await ensureAccountantStaffRows(admin, clinicId);

  const [staffRes, asstRes] = await Promise.all([
    admin
      .from("staff_members")
      .select(
        "id, full_name_ar, job_title_ar, base_salary, is_active, profile_id"
      )
      .eq("clinic_id", clinicId)
      .eq("is_active", true)
      .order("full_name_ar"),
    admin
      .from("assistants")
      .select(
        `id, doctor_id, full_name_ar, total_salary, doctor_share_percentage, is_active,
         doctor:doctors ( full_name_ar )`
      )
      .eq("clinic_id", clinicId)
      .eq("is_active", true)
      .order("full_name_ar"),
  ]);

  if (staffRes.error) {
    throw new Error(staffRes.error.message);
  }
  if (asstRes.error) {
    throw new Error(asstRes.error.message);
  }

  const staffPersons: PayrollPerson[] = (staffRes.data ?? []).map(mapStaffRow);

  const assistantPersons: PayrollPerson[] = (asstRes.data ?? []).map((a) => {
    const doctorName = Array.isArray(a.doctor)
      ? a.doctor[0]?.full_name_ar
      : (a.doctor as { full_name_ar: string } | null)?.full_name_ar;
    const role = doctorName ? `مساعد — ${doctorName}` : "مساعد طبيب";
    const name = a.full_name_ar as string;
    return {
      id: a.id as string,
      name,
      role,
      category: "assistant" as const,
      full_name_ar: name,
      job_title_ar: role,
      base_salary: Number(a.total_salary ?? 0),
      doctor_id: a.doctor_id as string,
      doctor_name_ar: doctorName ?? null,
      doctor_share_percentage: Number(a.doctor_share_percentage ?? 0),
      is_active: true as const,
    };
  });

  return [...staffPersons, ...assistantPersons].sort((a, b) =>
    a.name.localeCompare(b.name, "ar")
  );
}
