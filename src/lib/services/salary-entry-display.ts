import type { SupabaseClient } from "@supabase/supabase-js";
import {
  computeDoctorMonthlySettlement,
  type DoctorMonthlySettlement,
} from "@/lib/services/assistant-payroll";
import { computeStaffNetPay } from "@/lib/services/salary-entry-math";
import type { SalaryEntry, SalaryEntryType } from "@/types";

export const SALARY_ENTRY_TYPE_LABELS: Record<SalaryEntryType, string> = {
  advance: "سلفة",
  deduction: "خصم",
  absence: "خصم غياب",
  bonus: "مكافأة",
};

export const SALARY_PERSON_CATEGORY_LABELS = {
  staff: "موظف خدمات",
  accountant: "محاسب",
  assistant: "مساعد طبيب",
  doctor_salary: "طبيب — راتب ثابت",
} as const;

export interface SalaryEntryPersonDisplay {
  name: string;
  category: string;
  jobTitle: string;
}

function relationName(
  rel: { full_name_ar: string } | { full_name_ar: string }[] | null | undefined
): string {
  if (!rel) return "";
  if (Array.isArray(rel)) return rel[0]?.full_name_ar ?? "";
  return rel.full_name_ar;
}

/** اسم ونوع صاحب حركة الراتب — موظف / مساعد / طبيب */
export function resolveSalaryEntryPerson(entry: {
  staff_id?: string | null;
  assistant_id?: string | null;
  doctor_id?: string | null;
  staff?:
    | { full_name_ar: string; job_title_ar?: string | null }
    | { full_name_ar: string; job_title_ar?: string | null }[]
    | null;
  assistant?:
    | { full_name_ar: string }
    | { full_name_ar: string }[]
    | null;
  doctor?:
    | { full_name_ar: string }
    | { full_name_ar: string }[]
    | null;
}): SalaryEntryPersonDisplay {
  if (entry.doctor_id) {
    const name = relationName(entry.doctor) || "طبيب";
    return {
      name,
      category: SALARY_PERSON_CATEGORY_LABELS.doctor_salary,
      jobTitle: "راتب ثابت",
    };
  }
  if (entry.assistant_id) {
    const name = relationName(entry.assistant) || "مساعد";
    return {
      name,
      category: SALARY_PERSON_CATEGORY_LABELS.assistant,
      jobTitle: "مساعد طبيب",
    };
  }
  const staff = Array.isArray(entry.staff) ? entry.staff[0] : entry.staff;
  const job = staff?.job_title_ar?.trim() || "موظف خدمات";
  const isAccountant = /محاسب/i.test(job);
  return {
    name: staff?.full_name_ar ?? "موظف",
    category: isAccountant
      ? SALARY_PERSON_CATEGORY_LABELS.accountant
      : SALARY_PERSON_CATEGORY_LABELS.staff,
    jobTitle: job,
  };
}

export interface DoctorMonthSalaryBreakdown {
  baseSalary: number;
  advances: number;
  deductions: number;
  bonuses: number;
  netPayout: number;
  slipStatus: string | null;
  entries: Pick<SalaryEntry, "id" | "entry_type" | "amount" | "entry_date" | "notes_ar">[];
}

/** صافي راتب طبيب ثابت للشهر — من القسيمة أو الحركات */
export async function fetchDoctorMonthSalaryBreakdown(
  supabase: SupabaseClient,
  clinicId: string,
  doctorId: string,
  monthYear: string,
  baseSalary?: number
): Promise<DoctorMonthSalaryBreakdown | null> {
  let salary = baseSalary;
  if (salary == null) {
    const { data: doctor } = await supabase
      .from("doctors")
      .select("salary_amount, payment_type")
      .eq("id", doctorId)
      .eq("clinic_id", clinicId)
      .maybeSingle();
    if (!doctor || doctor.payment_type !== "salary") return null;
    salary = Number(doctor.salary_amount ?? 0);
  }

  const { from, to } = await import("@/lib/utils").then((m) =>
    m.monthDateRange(monthYear)
  );

  const [entriesRes, slipRes] = await Promise.all([
    supabase
      .from("salary_entries")
      .select("id, entry_type, amount, entry_date, notes_ar")
      .eq("clinic_id", clinicId)
      .eq("doctor_id", doctorId)
      .gte("entry_date", from)
      .lte("entry_date", to)
      .order("entry_date", { ascending: false }),
    supabase
      .from("salary_slips")
      .select("net_payout, base_salary, status")
      .eq("clinic_id", clinicId)
      .eq("doctor_id", doctorId)
      .eq("month_year", monthYear)
      .maybeSingle(),
  ]);

  const entries = (entriesRes.data ?? []) as Pick<
    SalaryEntry,
    "id" | "entry_type" | "amount" | "entry_date" | "notes_ar"
  >[];
  const computed = computeStaffNetPay(salary, entries);
  const slip = slipRes.data as {
    net_payout?: number;
    base_salary?: number;
    status?: string;
  } | null;

  const netPayout =
    slip?.net_payout != null ? Number(slip.net_payout) : computed.netPayout;

  return {
    baseSalary: slip?.base_salary != null ? Number(slip.base_salary) : salary,
    advances: computed.advances,
    deductions: computed.deductions,
    bonuses: computed.bonuses,
    netPayout,
    slipStatus: slip?.status ?? null,
    entries,
  };
}

/** دفعة واحدة لكل أطباء الراتب في شهر — لتقارير الإدارة */
export async function fetchDoctorSalaryBreakdownsBatch(
  supabase: SupabaseClient,
  clinicId: string,
  doctorIds: string[],
  monthYear: string,
  salaryByDoctor: Map<string, number>
): Promise<Map<string, DoctorMonthSalaryBreakdown>> {
  const result = new Map<string, DoctorMonthSalaryBreakdown>();
  if (!doctorIds.length) return result;

  const { monthDateRange } = await import("@/lib/utils");
  const { from, to } = monthDateRange(monthYear);

  const [entriesRes, slipsRes] = await Promise.all([
    supabase
      .from("salary_entries")
      .select("id, doctor_id, entry_type, amount, entry_date, notes_ar")
      .eq("clinic_id", clinicId)
      .in("doctor_id", doctorIds)
      .gte("entry_date", from)
      .lte("entry_date", to),
    supabase
      .from("salary_slips")
      .select("doctor_id, net_payout, base_salary, status")
      .eq("clinic_id", clinicId)
      .in("doctor_id", doctorIds)
      .eq("month_year", monthYear),
  ]);

  const entriesByDoctor = new Map<
    string,
    Pick<SalaryEntry, "id" | "entry_type" | "amount" | "entry_date" | "notes_ar">[]
  >();
  for (const row of entriesRes.data ?? []) {
    const id = row.doctor_id as string;
    const list = entriesByDoctor.get(id) ?? [];
    list.push({
      id: row.id as string,
      entry_type: row.entry_type as SalaryEntryType,
      amount: Number(row.amount ?? 0),
      entry_date: row.entry_date as string,
      notes_ar: (row.notes_ar as string) ?? null,
    });
    entriesByDoctor.set(id, list);
  }

  const slipByDoctor = new Map(
    (slipsRes.data ?? []).map((s) => [s.doctor_id as string, s])
  );

  for (const doctorId of doctorIds) {
    const baseSalary = salaryByDoctor.get(doctorId) ?? 0;
    const entries = entriesByDoctor.get(doctorId) ?? [];
    const computed = computeStaffNetPay(baseSalary, entries);
    const slip = slipByDoctor.get(doctorId) as {
      net_payout?: number;
      base_salary?: number;
      status?: string;
    } | undefined;
    const netPayout =
      slip?.net_payout != null ? Number(slip.net_payout) : computed.netPayout;

    result.set(doctorId, {
      baseSalary:
        slip?.base_salary != null ? Number(slip.base_salary) : baseSalary,
      advances: computed.advances,
      deductions: computed.deductions,
      bonuses: computed.bonuses,
      netPayout,
      slipStatus: slip?.status ?? null,
      entries,
    });
  }

  return result;
}

/** دمج تفاصيل راتب الطبيب الثابت في تسوية شهرية */
export function enrichSettlementWithSalaryBreakdown(
  settlement: DoctorMonthlySettlement,
  breakdown: DoctorMonthSalaryBreakdown
): DoctorMonthlySettlement {
  const enriched = computeDoctorMonthlySettlement(
    breakdown.netPayout,
    settlement.expenseLines,
    settlement.assistantLines
  );
  return {
    ...enriched,
    salaryBaseAmount: breakdown.baseSalary,
    salaryAdvances: breakdown.advances,
    salaryDeductions: breakdown.deductions,
    salaryBonuses: breakdown.bonuses,
    salaryNetAmount: breakdown.netPayout,
    salaryAdjustmentLines: breakdown.entries.map((e) => ({
      entryType: e.entry_type,
      entryTypeLabel:
        SALARY_ENTRY_TYPE_LABELS[e.entry_type as SalaryEntryType] ??
        e.entry_type,
      amount: Number(e.amount),
      entryDate: e.entry_date,
      notes: e.notes_ar,
    })),
  };
}
