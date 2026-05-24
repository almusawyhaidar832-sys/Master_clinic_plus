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

export interface DoctorLedgerSummary {
  id: string;
  full_name_ar: string;
  specialty_ar: string | null;
  percentage: string;
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
    operation_date: string;
    operation_name_ar: string;
    patientName: string;
    doctorName: string;
    total_amount: number;
    paid_amount: number;
    remaining_debt: number;
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
  supabase: SupabaseClient
): Promise<DoctorLedgerSummary[]> {
  const { data: doctors } = await supabase
    .from("doctors")
    .select("*")
    .eq("is_active", true)
    .order("full_name_ar");

  if (!doctors?.length) return [];

  const summaries = await Promise.all(
    doctors.map(async (doc) => {
      const [opsRes, withdrawnRes, pendingRes, balance] = await Promise.all([
        supabase
          .from("patient_operations")
          .select("doctor_share_amount")
          .eq("doctor_id", doc.id),
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

      const totalEarned = (opsRes.data ?? []).reduce(
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

      return {
        id: doc.id,
        full_name_ar: doc.full_name_ar,
        specialty_ar: doc.specialty_ar,
        percentage: doc.percentage,
        totalEarned,
        totalWithdrawn,
        pendingWithdrawalAmount,
        withdrawableBalance: balance,
        operationsCount: opsRes.data?.length ?? 0,
      };
    })
  );

  return summaries;
}

export async function fetchDoctorLedgerDetail(
  supabase: SupabaseClient,
  doctorId: string
) {
  const { data: doctor } = await supabase
    .from("doctors")
    .select("*")
    .eq("id", doctorId)
    .single();

  const [summary, opsRes, withdrawalsRes] = await Promise.all([
    fetchDoctorLedgers(supabase).then((list) =>
      list.find((d) => d.id === doctorId)
    ),
    supabase
      .from("patient_operations")
      .select(
        "*, patient:patients(full_name_ar)"
      )
      .eq("doctor_id", doctorId)
      .order("operation_date", { ascending: false })
      .limit(100),
    supabase
      .from("doctor_withdrawals")
      .select("*")
      .eq("doctor_id", doctorId)
      .order("requested_at", { ascending: false }),
  ]);

  return {
    doctor,
    summary,
    operations: opsRes.data ?? [],
    withdrawals: withdrawalsRes.data ?? [],
  };
}

export async function fetchMasterClinicReport(
  supabase: SupabaseClient,
  monthYear?: string
): Promise<MasterClinicReport> {
  const { start, end, my } = getMonthBounds(monthYear);

  const clinicProfile = await fetchClinicProfile(supabase);

  const [
    profitStats,
    today,
    doctors,
    pendingWithdrawalsRes,
    expensesRes,
    salaryEntriesRes,
    monthOpsRes,
    monthOpsCountRes,
  ] = await Promise.all([
    fetchClinicProfitStats(supabase),
    fetchTodaySummary(supabase),
    fetchDoctorLedgers(supabase),
    supabase
      .from("doctor_withdrawals")
      .select("id, amount, requested_at, doctor:doctors(full_name_ar)")
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
        "entry_type, amount, entry_date, notes_ar, staff:staff_members(full_name_ar, job_title_ar)"
      )
      .gte("entry_date", start)
      .lte("entry_date", end)
      .order("entry_date", { ascending: false }),
    supabase
      .from("patient_operations")
      .select(
        "operation_date, operation_name_ar, total_amount, paid_amount, remaining_debt, patient:patients(full_name_ar), doctor:doctors(full_name_ar)"
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

  const totalRevenue = monthBilled || profitStats.cashInflow;

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
      netProfit: profitStats.netProfit,
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
        (w.doctor as { full_name_ar: string })?.full_name_ar
      ),
      amount: Number(w.amount),
      requested_at: w.requested_at,
    })),
    expenses: expensesRes.data ?? [],
    salaryAdvances: (salaryEntriesRes.data ?? []).map((e) => ({
      staffName:
        (e.staff as { full_name_ar: string })?.full_name_ar ?? "موظف",
      jobTitle:
        (e.staff as { job_title_ar: string })?.job_title_ar ?? "",
      entryType: entryTypeLabels[e.entry_type] ?? e.entry_type,
      amount: Number(e.amount),
      entry_date: e.entry_date,
      notes: e.notes_ar,
    })),
    monthOperations: (monthOpsRes.data ?? []).map((op) => ({
      operation_date: op.operation_date,
      operation_name_ar: op.operation_name_ar,
      patientName:
        (op.patient as { full_name_ar: string })?.full_name_ar ?? "—",
      doctorName: formatDoctorDisplayName(
        (op.doctor as { full_name_ar: string })?.full_name_ar
      ),
      total_amount: Number(op.total_amount),
      paid_amount: Number(op.paid_amount),
      remaining_debt: Number(op.remaining_debt),
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
