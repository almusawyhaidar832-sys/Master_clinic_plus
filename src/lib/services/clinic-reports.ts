import type { SupabaseClient } from "@supabase/supabase-js";
import {
  fetchClinicProfile,
  getClinicDisplayName,
  formatDoctorDisplayName,
} from "@/lib/services/clinic-profile";
import type { ClinicProfile } from "@/types/clinic-profile";
import {
  fetchClinicProfitStats,
  fetchDoctorWithdrawableBalance,
  fetchTodaySummary,
} from "@/lib/services/clinic-stats";
import { currentMonthYear } from "@/lib/utils";
import {
  fetchRefundsForReport,
  fetchTotalRefundsAmount,
} from "@/lib/services/session-refunds";
import {
  doctorPaymentLabel,
  isSalaryDoctor,
  normalizeDoctorPaymentType,
  resolveDoctorPeriodEarned,
} from "@/lib/services/doctor-payment";
import type { DoctorPaymentType } from "@/types";
import {
  buildAssistantPayrollLines,
  buildAssistantPayrollLinesFromRecords,
  computeDoctorMonthlySettlement,
  doctorShareFromExpense,
  type DoctorMonthlySettlement,
} from "@/lib/services/assistant-payroll";
import { fetchPayrollRecordsForDoctorMonth } from "@/lib/services/assistant-payroll-records";

function relationName(
  rel: { full_name_ar: string } | { full_name_ar: string }[] | null | undefined
): string | undefined {
  if (!rel) return undefined;
  return Array.isArray(rel) ? rel[0]?.full_name_ar : rel.full_name_ar;
}

export interface DoctorLedgerSummary {
  id: string;
  full_name_ar: string;
  specialty_ar: string | null;
  percentage: string;
  payment_type: DoctorPaymentType;
  salary_amount: number;
  paymentLabel: string;
  totalEarned: number;
  totalWithdrawn: number;
  pendingWithdrawalAmount: number;
  withdrawableBalance: number;
  operationsCount: number;
}

export interface MasterClinicReport {
  generatedAt: string;
  clinicProfile: ClinicProfile | null;
  clinicName: string;
  periodLabel: string;
  monthYear: string;
  summary: {
    totalRevenue: number;
    totalClinicShare: number;
    generalExpenses: number;
    staffSalaries: number;
    doctorPayouts: number;
    outstandingDebts: number;
    netProfit: number;
    totalRefunds: number;
    cashInflow: number;
  };
  today: {
    operationsCount: number;
    totalCollected: number;
    totalRemainingDebt: number;
  };
  month: {
    operationsCount: number;
    totalCollected: number;
    totalRemainingDebt: number;
    totalBilled: number;
  };
  doctors: DoctorLedgerSummary[];
  pendingWithdrawals: {
    id: string;
    doctorName: string;
    amount: number;
    requested_at: string;
  }[];
  expenses: {
    description_ar: string;
    amount: number;
    expense_date: string;
  }[];
  salaryAdvances: {
    staffName: string;
    jobTitle: string;
    entryType: string;
    amount: number;
    entry_date: string;
    notes: string | null;
  }[];
  monthOperations: {
    operation_date?: string;
    operation_name_ar?: string;
    operation_type?: string;
    patientName: string;
    doctorName: string;
    total_amount: number;
    paid_amount: number;
    remaining_debt: number;
  }[];
  refunds: {
    id: string;
    patientName: string;
    amount: number;
    doctorName: string;
    date: string;
    reason: string;
  }[];
}

function getMonthBounds(monthYear?: string) {
  const my = monthYear ?? currentMonthYear();
  const [y, m] = my.split("-").map(Number);
  const start = `${y}-${String(m).padStart(2, "0")}-01`;
  const lastDay = new Date(y, m, 0).getDate();
  const end = `${y}-${String(m).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  return { start, end, my };
}

const entryTypeLabels: Record<string, string> = {
  advance: "سلفة",
  deduction: "خصم",
  absence: "خصم غياب",
};

export async function fetchDoctorLedgers(
  supabase: SupabaseClient,
  monthYear?: string
): Promise<DoctorLedgerSummary[]> {
  const { start, end } = getMonthBounds(monthYear);
  const periodScoped = Boolean(monthYear);
  const { getActiveClinicId } = await import("@/lib/clinic-context");
  const active = await getActiveClinicId(supabase);
  if (!active?.clinicId) return [];

  const { data: doctors } = await supabase
    .from("doctors")
    .select("*")
    .eq("clinic_id", active.clinicId)
    .eq("is_active", true)
    .order("full_name_ar");

  if (!doctors?.length) return [];

  const summaries = await Promise.all(
    doctors.map(async (doc) => {
      let opsQuery = supabase
        .from("patient_operations")
        .select("doctor_share_amount")
        .eq("clinic_id", active.clinicId)
        .eq("doctor_id", doc.id);

      if (periodScoped) {
        opsQuery = opsQuery
          .gte("operation_date", start)
          .lte("operation_date", end);
      }

      const [opsRes, withdrawnRes, pendingRes, balance] = await Promise.all([
        opsQuery,
        supabase
          .from("doctor_withdrawals")
          .select("amount")
          .eq("doctor_id", doc.id)
          .in("status", ["approved", "paid"]),
        supabase
          .from("doctor_withdrawals")
          .select("amount")
          .eq("doctor_id", doc.id)
          .eq("status", "pending"),
        fetchDoctorWithdrawableBalance(supabase, doc.id),
      ]);

      const operationsShareSum = (opsRes.data ?? []).reduce(
        (s, r) => s + Number(r.doctor_share_amount ?? 0),
        0
      );
      const totalWithdrawn = (withdrawnRes.data ?? []).reduce(
        (s, r) => s + Number(r.amount ?? 0),
        0
      );
      const pendingWithdrawalAmount = (pendingRes.data ?? []).reduce(
        (s, r) => s + Number(r.amount ?? 0),
        0
      );

      const payment_type = normalizeDoctorPaymentType(doc.payment_type);
      const salary_amount = Number(doc.salary_amount ?? 0);
      const doctorForCalc = { payment_type, salary_amount };
      const totalEarned = periodScoped
        ? resolveDoctorPeriodEarned(doctorForCalc, operationsShareSum)
        : resolveDoctorPeriodEarned(doctorForCalc, operationsShareSum);

      let withdrawableBalance = balance;
      if (isSalaryDoctor(doctorForCalc) && periodScoped) {
        withdrawableBalance = Math.max(
          0,
          totalEarned - totalWithdrawn - pendingWithdrawalAmount
        );
      }

      return {
        id: doc.id,
        full_name_ar: doc.full_name_ar,
        specialty_ar: doc.specialty_ar,
        percentage: doc.percentage,
        payment_type,
        salary_amount,
        paymentLabel: doctorPaymentLabel({
          payment_type,
          percentage: doc.percentage,
          salary_amount,
        }),
        totalEarned,
        totalWithdrawn,
        pendingWithdrawalAmount,
        withdrawableBalance,
        operationsCount: opsRes.data?.length ?? 0,
      };
    })
  );

  return summaries;
}

export async function fetchDoctorLedgerDetail(
  supabase: SupabaseClient,
  doctorId: string,
  monthYear?: string
) {
  const { start, end } = getMonthBounds(monthYear);
  const periodScoped = Boolean(monthYear);

  const { data: doctor } = await supabase
    .from("doctors")
    .select("*")
    .eq("id", doctorId)
    .single();

  let opsQuery = supabase
    .from("patient_operations")
    .select("*, patient:patients!patient_id(full_name_ar)")
    .eq("doctor_id", doctorId)
    .order("operation_date", { ascending: false })
    .limit(100);

  if (periodScoped) {
    opsQuery = opsQuery
      .gte("operation_date", start)
      .lte("operation_date", end);
  }

  let expensesQuery = supabase
    .from("doctor_expenses")
    .select("*")
    .eq("doctor_id", doctorId)
    .order("expense_date", { ascending: false });

  if (periodScoped) {
    expensesQuery = expensesQuery
      .gte("expense_date", start)
      .lte("expense_date", end);
  }

  const payrollPromise =
    periodScoped && monthYear
      ? fetchPayrollRecordsForDoctorMonth(supabase, doctorId, monthYear)
      : Promise.resolve([]);

  const assistantsFallbackPromise = periodScoped
    ? Promise.resolve({ data: [] as { id: string; full_name_ar: string; total_salary: number; doctor_share_percentage: number }[] })
    : supabase
        .from("assistants")
        .select("id, full_name_ar, total_salary, doctor_share_percentage")
        .eq("doctor_id", doctorId)
        .eq("is_active", true);

  const [summary, opsRes, withdrawalsRes, payrollRes, expensesRes, assistantsFallback] =
    await Promise.all([
      fetchDoctorLedgers(supabase, monthYear).then((list) =>
        list.find((d) => d.id === doctorId)
      ),
      opsQuery,
      supabase
        .from("doctor_withdrawals")
        .select("*")
        .eq("doctor_id", doctorId)
        .order("requested_at", { ascending: false }),
      payrollPromise,
      expensesQuery,
      assistantsFallbackPromise,
    ]);

  const operations = opsRes.data ?? [];
  const totalDoctorIncome = operations.reduce(
    (s, r) => s + Number(r.doctor_share_amount ?? 0),
    0
  );

  const expenseLines = (expensesRes.data ?? []).map((e) => ({
    id: e.id as string,
    description: (e.description_ar as string) || "صرفية عيادة",
    amount: Number(e.amount ?? 0),
    percentageSplit: Number(e.percentage_split ?? 0),
    doctorShare: doctorShareFromExpense(
      Number(e.amount ?? 0),
      Number(e.percentage_split ?? 0)
    ),
    expenseDate: e.expense_date as string,
  }));

  const assistantLines =
    payrollRes.length > 0
      ? buildAssistantPayrollLinesFromRecords(payrollRes)
      : periodScoped
        ? []
        : buildAssistantPayrollLines(
            (assistantsFallback.data ?? []).map((a) => ({
              id: a.id as string,
              full_name_ar: a.full_name_ar as string,
              total_salary: Number(a.total_salary ?? 0),
              doctor_share_percentage: Number(a.doctor_share_percentage ?? 0),
            }))
          );

  const settlement: DoctorMonthlySettlement | null = periodScoped
    ? computeDoctorMonthlySettlement(
        summary?.totalEarned ?? totalDoctorIncome,
        expenseLines,
        assistantLines
      )
    : null;

  return {
    doctor,
    summary,
    operations,
    withdrawals: withdrawalsRes.data ?? [],
    settlement,
  };
}

export async function fetchMasterClinicReport(
  supabase: SupabaseClient,
  monthYear?: string
): Promise<MasterClinicReport> {
  const { start, end, my } = getMonthBounds(monthYear);

  const clinicProfile = await fetchClinicProfile(supabase);
  const active = await import("@/lib/clinic-context").then((m) =>
    m.getActiveClinicId(supabase)
  );
  const clinicId = active?.clinicId;

  const [
    profitStats,
    today,
    doctors,
    pendingWithdrawalsRes,
    expensesRes,
    salaryEntriesRes,
    monthOpsRes,
    monthOpsCountRes,
    refunds,
    monthRefundsTotal,
  ] = await Promise.all([
    fetchClinicProfitStats(supabase),
    fetchTodaySummary(supabase),
    fetchDoctorLedgers(supabase, my),
    supabase
      .from("doctor_withdrawals")
      .select("id, amount, requested_at, doctor:doctors!doctor_id(full_name_ar)")
      .eq("status", "pending")
      .order("requested_at", { ascending: false }),
    supabase
      .from("expenses")
      .select("description_ar, amount, expense_date")
      .gte("expense_date", start)
      .lte("expense_date", end)
      .order("expense_date", { ascending: false }),
    supabase
      .from("salary_entries")
      .select(
        "entry_type, amount, entry_date, notes_ar, staff:staff_members!staff_id(full_name_ar, job_title_ar)"
      )
      .gte("entry_date", start)
      .lte("entry_date", end)
      .order("entry_date", { ascending: false }),
    supabase
      .from("patient_operations")
      .select(
        "operation_date, operation_type, operation_name_ar, total_amount, paid_amount, remaining_debt, patient:patients!patient_id(full_name_ar), doctor:doctors!doctor_id(full_name_ar)"
      )
      .gte("operation_date", start)
      .lte("operation_date", end)
      .order("operation_date", { ascending: false })
      .limit(200),
    supabase
      .from("patient_operations")
      .select("paid_amount, remaining_debt, total_amount")
      .gte("operation_date", start)
      .lte("operation_date", end),
    fetchRefundsForReport(supabase, start, end),
    clinicId
      ? fetchTotalRefundsAmount(supabase, {
          clinicId,
          from: start,
          to: end,
        })
      : Promise.resolve(0),
  ]);

  const monthRows = monthOpsCountRes.data ?? [];
  const monthCollected = monthRows.reduce(
    (s, r) => s + Number(r.paid_amount ?? 0),
    0
  );
  const monthDebt = monthRows.reduce(
    (s, r) => s + Number(r.remaining_debt ?? 0),
    0
  );
  const monthBilled = monthRows.reduce(
    (s, r) => s + Number(r.total_amount ?? 0),
    0
  );

  const totalRevenue = monthCollected || profitStats.cashInflow;
  const totalRefunds = Math.round(monthRefundsTotal * 100) / 100;
  const netProfit = Math.round(
    (totalRevenue -
      totalRefunds -
      profitStats.totalExpenses -
      profitStats.totalSalariesPaid) *
      100
  ) / 100;

  return {
    generatedAt: new Date().toISOString(),
    clinicProfile,
    clinicName: getClinicDisplayName(clinicProfile),
    periodLabel: `شهر ${my}`,
    monthYear: my,
    summary: {
      totalRevenue,
      totalClinicShare: profitStats.clinicShareTotal,
      generalExpenses: profitStats.totalExpenses,
      staffSalaries: profitStats.totalSalariesPaid,
      doctorPayouts: profitStats.doctorShareTotal,
      outstandingDebts: profitStats.outstandingDebts,
      totalRefunds,
      netProfit,
      cashInflow: profitStats.cashInflow,
    },
    today,
    month: {
      operationsCount: monthRows.length,
      totalCollected: monthCollected,
      totalRemainingDebt: monthDebt,
      totalBilled: monthBilled,
    },
    doctors,
    pendingWithdrawals: (pendingWithdrawalsRes.data ?? []).map((w) => ({
      id: w.id,
      doctorName: formatDoctorDisplayName(
        relationName(w.doctor as { full_name_ar: string } | { full_name_ar: string }[])
      ),
      amount: Number(w.amount),
      requested_at: w.requested_at,
    })),
    expenses: expensesRes.data ?? [],
    salaryAdvances: (salaryEntriesRes.data ?? []).map((e) => ({
      staffName:
        relationName(
          e.staff as
            | { full_name_ar: string; job_title_ar?: string }
            | { full_name_ar: string; job_title_ar?: string }[]
        ) ?? "موظف",
      jobTitle:
        (Array.isArray(e.staff) ? e.staff[0]?.job_title_ar : (e.staff as { job_title_ar?: string })?.job_title_ar) ??
        "",
      entryType: entryTypeLabels[e.entry_type] ?? e.entry_type,
      amount: Number(e.amount),
      entry_date: e.entry_date,
      notes: e.notes_ar,
    })),
    refunds: refunds.map((r) => ({
      id: r.id,
      patientName: r.patientName,
      amount: r.amount,
      doctorName: formatDoctorDisplayName(r.doctorName),
      date: r.date,
      reason: r.reason,
    })),
    monthOperations: (monthOpsRes.data ?? []).map((op) => ({
      operation_date: op.operation_date,
      operation_name_ar: op.operation_type || op.operation_name_ar,
      operation_type: op.operation_type,
      patientName:
        relationName(
          op.patient as { full_name_ar: string } | { full_name_ar: string }[]
        ) ?? "—",
      doctorName: formatDoctorDisplayName(
        relationName(
          op.doctor as { full_name_ar: string } | { full_name_ar: string }[]
        )
      ),
      total_amount: Number(op.total_amount),
      paid_amount: Number(op.paid_amount),
      remaining_debt: Number(op.remaining_debt ?? Math.max(0, Number(op.total_amount) - Number(op.paid_amount))),
    })),
  };
}

/** Alias for accountant handover report — same comprehensive dataset */
export async function fetchAccountantClinicReport(
  supabase: SupabaseClient,
  monthYear?: string
): Promise<MasterClinicReport> {
  return fetchMasterClinicReport(supabase, monthYear);
}

export function getReportPeriodOptions(): { value: string; label: string }[] {
  const options: { value: string; label: string }[] = [];
  const now = new Date();
  for (let i = 0; i < 6; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const label = d.toLocaleDateString("ar-EG", {
      year: "numeric",
      month: "long",
    });
    options.push({ value, label });
  }
  return options;
}
