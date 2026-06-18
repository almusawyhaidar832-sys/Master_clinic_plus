import type { SupabaseClient } from "@supabase/supabase-js";
import { authPortalHeaders } from "@/lib/auth/api-portal";
import type { AssistantCompensationMode } from "@/types";
import {
  isDailyWageAssistant,
  normalizeAssistantCompensationMode,
} from "@/lib/services/assistant-compensation";

function assistantRoleLabel(
  doctorName: string | null | undefined,
  compensationMode: AssistantCompensationMode
): string {
  const prefix = isDailyWageAssistant(compensationMode)
    ? "مساعد يومي"
    : "مساعد";
  return doctorName ? `${prefix} — ${doctorName}` : `${prefix} طبيب`;
}

export type PayrollEmployeeCategory =
  | "assistant"
  | "general"
  | "accountant"
  | "doctor_salary";

/** عنصر موحّد في قائمة الرواتب */
export interface PayrollPerson {
  id: string;
  name: string;
  role: string;
  category: PayrollEmployeeCategory;
  full_name_ar: string;
  job_title_ar: string;
  base_salary: number;
  doctor_id?: string | null;
  doctor_name_ar?: string | null;
  doctor_share_percentage?: number;
  compensation_mode?: AssistantCompensationMode;
  profile_id?: string | null;
  is_active: true;
}

const CATEGORY_LABELS: Record<PayrollEmployeeCategory, string> = {
  assistant: "مساعد طبيب",
  general: "خدمات",
  accountant: "محاسب",
  doctor_salary: "طبيب — راتب ثابت",
};

export function payrollCategoryLabel(category: PayrollEmployeeCategory): string {
  return CATEGORY_LABELS[category];
}

/** جلب بيانات موظف واحد من القاعدة (للتعبئة التلقائية عند الاختيار) */
export async function fetchPayrollPersonByKey(
  supabase: SupabaseClient,
  clinicId: string,
  key: string
): Promise<PayrollPerson | null> {
  const parsed = parsePayrollPersonKey(key);
  if (!parsed) return null;

  if (parsed.category === "doctor_salary") {
    const { data } = await supabase
      .from("doctors")
      .select("id, full_name_ar, specialty_ar, salary_amount, payment_type, is_active")
      .eq("clinic_id", clinicId)
      .eq("id", parsed.id)
      .eq("is_active", true)
      .eq("payment_type", "salary")
      .maybeSingle();
    if (!data) return null;
    const specialty = (data.specialty_ar as string) || "طبيب";
    const name = data.full_name_ar as string;
    return {
      id: data.id as string,
      name,
      role: `راتب ثابت — ${specialty}`,
      category: "doctor_salary",
      full_name_ar: name,
      job_title_ar: `طبيب — ${specialty}`,
      base_salary: Number(data.salary_amount ?? 0),
      is_active: true,
    };
  }

  if (parsed.category === "general" || parsed.category === "accountant") {
    const { data } = await supabase
      .from("staff_members")
      .select("id, full_name_ar, job_title_ar, base_salary, is_active, profile_id")
      .eq("clinic_id", clinicId)
      .eq("id", parsed.id)
      .eq("is_active", true)
      .maybeSingle();
    if (!data) return null;
    const isAccountant = Boolean(data.profile_id);
    const job =
      (data.job_title_ar as string) ||
      (isAccountant ? "محاسب" : "موظف خدمات");
    return {
      id: data.id as string,
      name: data.full_name_ar as string,
      role: job,
      category: isAccountant ? "accountant" : "general",
      full_name_ar: data.full_name_ar as string,
      job_title_ar: job,
      base_salary: Number(data.base_salary ?? 0),
      profile_id: (data.profile_id as string) ?? null,
      is_active: true,
    };
  }

  if (parsed.category !== "assistant") return null;

  const { data } = await supabase
    .from("assistants")
    .select(
      `id, doctor_id, full_name_ar, total_salary, doctor_share_percentage, compensation_mode, is_active,
       doctor:doctors ( full_name_ar )`
    )
    .eq("clinic_id", clinicId)
    .eq("id", parsed.id)
    .eq("is_active", true)
    .maybeSingle();

  if (!data) return null;
  const doctorName = Array.isArray(data.doctor)
    ? data.doctor[0]?.full_name_ar
    : (data.doctor as { full_name_ar: string } | null)?.full_name_ar;
  const compensationMode = normalizeAssistantCompensationMode(
    data.compensation_mode as string | undefined
  );
  const role = assistantRoleLabel(doctorName, compensationMode);
  const name = data.full_name_ar as string;
  return {
    id: data.id as string,
    name,
    role,
    category: "assistant",
    full_name_ar: name,
    job_title_ar: role,
    base_salary: isDailyWageAssistant(compensationMode)
      ? 0
      : Number(data.total_salary ?? 0),
    doctor_id: data.doctor_id as string,
    doctor_name_ar: doctorName ?? null,
    doctor_share_percentage: Number(data.doctor_share_percentage ?? 0),
    compensation_mode: compensationMode,
    is_active: true,
  };
}

export function payrollPersonKey(person: PayrollPerson): string {
  if (person.category === "assistant") return `assistant:${person.id}`;
  if (person.category === "accountant") return `accountant:${person.id}`;
  if (person.category === "doctor_salary") return `doctor_salary:${person.id}`;
  return `general:${person.id}`;
}

export function parsePayrollPersonKey(key: string): {
  category: PayrollEmployeeCategory;
  id: string;
} | null {
  if (!key) return null;
  if (key.startsWith("assistant:")) {
    return { category: "assistant", id: key.slice("assistant:".length) };
  }
  if (key.startsWith("accountant:")) {
    return { category: "accountant", id: key.slice("accountant:".length) };
  }
  if (key.startsWith("general:")) {
    return { category: "general", id: key.slice("general:".length) };
  }
  if (key.startsWith("doctor_salary:")) {
    return {
      category: "doctor_salary",
      id: key.slice("doctor_salary:".length),
    };
  }
  // توافق قديم
  if (key.startsWith("employee:staff:")) {
    return {
      category: "general",
      id: key.slice("employee:staff:".length),
    };
  }
  if (key.startsWith("staff:")) {
    return { category: "general", id: key.slice("staff:".length) };
  }
  return null;
}

/** جلب القائمة الموحدة عبر API (يتجاوز RLS — نفس مسار إضافة الموظف) */
export async function fetchActivePayrollPersonsViaApi(): Promise<PayrollPerson[]> {
  const res = await fetch("/api/payroll/persons", {
    credentials: "include",
    headers: authPortalHeaders("accountant"),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      (json as { error?: string }).error ?? "تعذر جلب قائمة العاملين"
    );
  }
  return (json as { persons?: PayrollPerson[] }).persons ?? [];
}

/**
 * قائمة موحدة: مساعدو الأطباء + موظفو الخدمات العامون (is_active = true فقط).
 * لا ربط للموظف العام بأي طبيب.
 */
export async function fetchActivePayrollPersons(
  supabase: SupabaseClient,
  clinicId: string
): Promise<PayrollPerson[]> {
  const [staffRes, asstRes, docSalaryRes] = await Promise.all([
    supabase
      .from("staff_members")
      .select("id, full_name_ar, job_title_ar, base_salary, is_active, profile_id")
      .eq("clinic_id", clinicId)
      .eq("is_active", true)
      .order("full_name_ar"),
    supabase
      .from("assistants")
      .select(
        `id, doctor_id, full_name_ar, total_salary, doctor_share_percentage, compensation_mode, is_active,
         doctor:doctors ( full_name_ar )`
      )
      .eq("clinic_id", clinicId)
      .eq("is_active", true)
      .order("full_name_ar"),
    supabase
      .from("doctors")
      .select("id, full_name_ar, specialty_ar, salary_amount, payment_type")
      .eq("clinic_id", clinicId)
      .eq("is_active", true)
      .eq("payment_type", "salary")
      .order("full_name_ar"),
  ]);

  if (staffRes.error) {
    console.error("[payroll-persons] staff_members:", staffRes.error.message);
  }
  if (asstRes.error) {
    console.error("[payroll-persons] assistants:", asstRes.error.message);
  }
  if (docSalaryRes.error) {
    console.error("[payroll-persons] doctors:", docSalaryRes.error.message);
  }

  const staffPersons: PayrollPerson[] = (staffRes.data ?? []).map((s) => {
    const isAccountant = Boolean(s.profile_id);
    const job =
      (s.job_title_ar as string) ||
      (isAccountant ? "محاسب" : "موظف خدمات");
    return {
      id: s.id as string,
      name: s.full_name_ar as string,
      role: job,
      category: isAccountant ? ("accountant" as const) : ("general" as const),
      full_name_ar: s.full_name_ar as string,
      job_title_ar: job,
      base_salary: Number(s.base_salary ?? 0),
      profile_id: (s.profile_id as string) ?? null,
      is_active: true as const,
    };
  });

  const assistantPersons: PayrollPerson[] = (asstRes.data ?? []).map((a) => {
    const doctorName = Array.isArray(a.doctor)
      ? a.doctor[0]?.full_name_ar
      : (a.doctor as { full_name_ar: string } | null)?.full_name_ar;
    const compensationMode = normalizeAssistantCompensationMode(
      a.compensation_mode as string | undefined
    );
    const role = assistantRoleLabel(doctorName, compensationMode);
    const name = a.full_name_ar as string;
    return {
      id: a.id as string,
      name,
      role,
      category: "assistant" as const,
      full_name_ar: name,
      job_title_ar: role,
      base_salary: isDailyWageAssistant(compensationMode)
        ? 0
        : Number(a.total_salary ?? 0),
      doctor_id: a.doctor_id as string,
      doctor_name_ar: doctorName ?? null,
      doctor_share_percentage: Number(a.doctor_share_percentage ?? 0),
      compensation_mode: compensationMode,
      is_active: true as const,
    };
  });

  const doctorSalaryPersons: PayrollPerson[] = (docSalaryRes.data ?? []).map(
    (d) => {
      const specialty = (d.specialty_ar as string) || "طبيب";
      const name = d.full_name_ar as string;
      return {
        id: d.id as string,
        name,
        role: `راتب ثابت — ${specialty}`,
        category: "doctor_salary" as const,
        full_name_ar: name,
        job_title_ar: `طبيب — ${specialty}`,
        base_salary: Number(d.salary_amount ?? 0),
        is_active: true as const,
      };
    }
  );

  return [...staffPersons, ...assistantPersons, ...doctorSalaryPersons].sort(
    (a, b) => a.name.localeCompare(b.name, "ar")
  );
}
