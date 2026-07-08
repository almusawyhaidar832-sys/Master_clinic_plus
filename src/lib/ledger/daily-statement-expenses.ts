import type { SupabaseClient } from "@supabase/supabase-js";
import { doctorShareFromExpense } from "@/lib/services/assistant-payroll";
import { resolveLedgerActorNames } from "@/lib/services/profit-deduction-ledger";

export type DailyDoctorExpenseLine = {
  id: string;
  doctorId: string;
  doctorName: string;
  expenseDate: string;
  description: string;
  totalAmount: number;
  doctorShare: number;
  clinicShare: number;
  percentageSplit: number;
  actorName?: string;
};

export type DailyClinicExpenseLine = {
  id: string;
  expenseDate: string;
  description: string;
  amount: number;
  categoryName?: string;
  actorName?: string;
};

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

function relationOne<T>(rel: T | T[] | null | undefined): T | null {
  if (!rel) return null;
  return Array.isArray(rel) ? rel[0] ?? null : rel;
}

export async function fetchDailyDoctorExpenseLines(
  supabase: SupabaseClient,
  clinicId: string,
  input: { dateFrom: string; dateTo: string; doctorId?: string }
): Promise<DailyDoctorExpenseLine[]> {
  let query = supabase
    .from("doctor_expenses")
    .select(
      "id, doctor_id, amount, percentage_split, expense_date, description_ar, created_by, doctor:doctors(full_name_ar)"
    )
    .eq("clinic_id", clinicId)
    .gte("expense_date", input.dateFrom)
    .lte("expense_date", input.dateTo)
    .order("expense_date", { ascending: false });

  if (input.doctorId) {
    query = query.eq("doctor_id", input.doctorId);
  }

  const { data, error } = await query;
  if (error || !data?.length) return [];

  const expenseIds = data.map((row) => String(row.id));
  const actorMap = await resolveLedgerActorNames(supabase, clinicId, {
    expenseIds: [],
    doctorExpenseIds: expenseIds,
    payrollParentIds: [],
    financialTxIds: [],
  });

  return data.map((row) => {
    const totalAmount = roundMoney(Number(row.amount ?? 0));
    const percentageSplit = Number(row.percentage_split ?? 50);
    const doctorShare = doctorShareFromExpense(totalAmount, percentageSplit);
    const clinicShare = roundMoney(totalAmount - doctorShare);
    const doctor = relationOne(
      row.doctor as { full_name_ar?: string } | { full_name_ar?: string }[] | null
    );
    const id = String(row.id);

    return {
      id,
      doctorId: String(row.doctor_id ?? ""),
      doctorName: String(doctor?.full_name_ar ?? "").trim() || "طبيب",
      expenseDate: String(row.expense_date ?? ""),
      description:
        String(row.description_ar ?? "").trim() || "فاتورة صرفية طبيب",
      totalAmount,
      doctorShare,
      clinicShare,
      percentageSplit,
      actorName: actorMap.get(id),
    };
  });
}

export async function fetchDailyClinicExpenseLines(
  supabase: SupabaseClient,
  clinicId: string,
  input: { dateFrom: string; dateTo: string }
): Promise<DailyClinicExpenseLine[]> {
  const { data, error } = await supabase
    .from("expenses")
    .select(
      "id, description_ar, amount, expense_date, expense_kind, created_by, category:expense_categories(name_ar)"
    )
    .eq("clinic_id", clinicId)
    .gte("expense_date", input.dateFrom)
    .lte("expense_date", input.dateTo)
    .order("expense_date", { ascending: false });

  if (error || !data?.length) return [];

  const expenseIds = data
    .filter((row) => (row.expense_kind ?? "general") !== "doctor_salary")
    .map((row) => String(row.id));

  const actorMap = await resolveLedgerActorNames(supabase, clinicId, {
    expenseIds,
    doctorExpenseIds: [],
    payrollParentIds: [],
    financialTxIds: [],
  });

  const lines: DailyClinicExpenseLine[] = [];

  for (const row of data) {
    if ((row.expense_kind ?? "general") === "doctor_salary") continue;
    const amount = roundMoney(Number(row.amount ?? 0));
    if (amount <= 0) continue;

    const category = relationOne(
      row.category as { name_ar?: string } | { name_ar?: string }[] | null
    );
    const id = String(row.id);

    lines.push({
      id,
      expenseDate: String(row.expense_date ?? ""),
      description:
        String(row.description_ar ?? "").trim() || "صرفية عيادة",
      amount,
      categoryName: category?.name_ar?.trim() || undefined,
      actorName: actorMap.get(id),
    });
  }

  return lines;
}

export function sumDoctorExpenseDeductions(
  lines: DailyDoctorExpenseLine[]
): { doctor: number; clinic: number; total: number } {
  let doctor = 0;
  let clinic = 0;
  for (const line of lines) {
    doctor += line.doctorShare;
    clinic += line.clinicShare;
  }
  return {
    doctor: roundMoney(doctor),
    clinic: roundMoney(clinic),
    total: roundMoney(doctor + clinic),
  };
}

export function sumClinicGeneralExpenses(lines: DailyClinicExpenseLine[]): number {
  return roundMoney(lines.reduce((s, line) => s + line.amount, 0));
}
