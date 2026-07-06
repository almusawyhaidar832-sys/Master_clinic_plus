import type { SupabaseClient } from "@supabase/supabase-js";
import { calculateClinicProfit } from "@/lib/finance";
import {
  fetchClinicShareExpenseTotal,
  fetchOutstandingDebts,
  fetchTreatmentLevelShares,
} from "@/lib/services/clinic-financial-aggregate";
import {
  fetchPeriodVisitorDebt,
} from "@/lib/services/executive-snapshot";
import { getActiveClinicId } from "@/lib/clinic-context";
import { fetchClinicBalanceTopupsForPeriod, fetchClinicBalanceTopupsTotal } from "@/lib/services/balance-topup";
import { formatCurrency, todayISO } from "@/lib/utils";

export interface TodaySummary {
  operationsCount: number;
  totalRemainingDebt: number;
  totalCollected: number;
}

export interface ClinicProfitStats {
  cashInflow: number;
  outstandingDebts: number;
  netProfit: number;
  totalRefunds: number;
  clinicShareTotal: number;
  doctorShareTotal: number;
  totalExpenses: number;
  totalSalariesPaid: number;
  breakdown: {
    label: string;
    amount: number;
  }[];
}

/** ملخص يوم واحد — للتقرير الشهري (اليوم الحالي أو آخر يوم في الشهر) */
export async function fetchDaySummary(
  supabase: SupabaseClient,
  date: string
): Promise<TodaySummary> {
  const active = await getActiveClinicId(supabase);

  if (!active?.clinicId) {
    return { operationsCount: 0, totalRemainingDebt: 0, totalCollected: 0 };
  }

  const [visitorResult, opsRes] = await Promise.all([
    fetchPeriodVisitorDebt(supabase, active.clinicId, date, date),
    supabase
      .from("patient_operations")
      .select("paid_amount", { count: "exact" })
      .eq("clinic_id", active.clinicId)
      .eq("operation_date", date),
  ]);

  const rows = opsRes.data ?? [];

  return {
    operationsCount: opsRes.count ?? rows.length,
    totalRemainingDebt: visitorResult.debt,
    totalCollected: rows.reduce(
      (s, op) => s + Number(op.paid_amount ?? 0),
      0
    ),
  };
}

export async function fetchTodaySummary(
  supabase: SupabaseClient
): Promise<TodaySummary> {
  return fetchDaySummary(supabase, todayISO());
}

const emptyProfitStats = (): ClinicProfitStats => ({
  cashInflow: 0,
  outstandingDebts: 0,
  netProfit: 0,
  totalRefunds: 0,
  clinicShareTotal: 0,
  doctorShareTotal: 0,
  totalExpenses: 0,
  totalSalariesPaid: 0,
  breakdown: [],
});

/** إحصائيات مالية لشهر أو فترة محددة — للتقارير التاريخية */
export async function fetchClinicProfitStatsForPeriod(
  supabase: SupabaseClient,
  clinicId: string,
  from: string,
  to: string
): Promise<ClinicProfitStats> {
  const { fetchTotalRefundsAmount } = await import(
    "@/lib/services/session-refunds"
  );
  const { fetchResolvedSalaryDeductionForPeriod, fetchReviewFeesInPeriod } =
    await import("@/lib/services/executive-snapshot");

  const [
    opsRes,
    expensesRes,
    totalSalariesPaid,
    totalRefunds,
    clinicExpenseShareRes,
    visitorDebt,
    reviewFees,
    balanceTopups,
  ] = await Promise.all([
    supabase
      .from("patient_operations")
      .select("paid_amount, clinic_share_amount, doctor_share_amount")
      .eq("clinic_id", clinicId)
      .gte("operation_date", from)
      .lte("operation_date", to),
    supabase
      .from("expenses")
      .select("amount, expense_kind")
      .eq("clinic_id", clinicId)
      .gte("expense_date", from)
      .lte("expense_date", to),
    fetchResolvedSalaryDeductionForPeriod(supabase, clinicId, from, to),
    fetchTotalRefundsAmount(supabase, { clinicId, from, to }),
    supabase
      .from("transactions")
      .select("amount")
      .eq("clinic_id", clinicId)
      .eq("type", "doctor_expense_clinic")
      .lt("amount", 0)
      .gte("transaction_date", from)
      .lte("transaction_date", to),
    fetchPeriodVisitorDebt(supabase, clinicId, from, to),
    fetchReviewFeesInPeriod(supabase, clinicId, from, to),
    fetchClinicBalanceTopupsForPeriod(supabase, clinicId, from, to),
  ]);

  const ops = opsRes.data ?? [];
  const cashInflow = ops.reduce((s, r) => s + Number(r.paid_amount ?? 0), 0);
  const clinicShareTotal = ops.reduce(
    (s, r) => s + Number(r.clinic_share_amount ?? 0),
    0
  );
  const doctorShareTotal = ops.reduce(
    (s, r) => s + Number(r.doctor_share_amount ?? 0),
    0
  );
  const generalExpenses = (expensesRes.data ?? [])
    .filter((r) => (r.expense_kind ?? "general") !== "doctor_salary")
    .reduce((s, r) => s + Number(r.amount ?? 0), 0);
  const clinicExpenseShare = (clinicExpenseShareRes.data ?? []).reduce(
    (s, row) => s + Math.abs(Number(row.amount ?? 0)),
    0
  );
  const totalExpenses = generalExpenses + clinicExpenseShare;
  const outstandingDebts = visitorDebt.debt;
  const refundsRounded = Math.round(totalRefunds * 100) / 100;
  const reviewFeesTotal = reviewFees.total;
  const netProfit = Math.round(
    (clinicShareTotal + reviewFeesTotal - totalExpenses - totalSalariesPaid + balanceTopups) *
      100
  ) / 100;

  return {
    cashInflow,
    outstandingDebts,
    netProfit,
    totalRefunds: refundsRounded,
    clinicShareTotal,
    doctorShareTotal,
    totalExpenses,
    totalSalariesPaid,
    breakdown: [
      { label: "صافي المحصّل (بعد المرتجعات)", amount: cashInflow },
      { label: "حصة العيادة من العمليات", amount: clinicShareTotal },
      ...(reviewFeesTotal > 0
        ? [{ label: "كشفيات المراجعين", amount: reviewFeesTotal }]
        : []),
      ...(balanceTopups > 0
        ? [{ label: "شحن رصيد العيادة", amount: balanceTopups }]
        : []),
      { label: "صرفيات العيادة", amount: -generalExpenses },
      {
        label: "حصة العيادة من صرفيات الأطباء",
        amount: -clinicExpenseShare,
      },
      { label: "رواتب مؤكَّد صرفها", amount: -totalSalariesPaid },
      { label: "أرباح الأطباء (محافظ — منفصلة)", amount: doctorShareTotal },
      { label: "صافي ربح العيادة", amount: netProfit },
    ],
  };
}

export async function fetchClinicProfitStats(
  supabase: SupabaseClient
): Promise<ClinicProfitStats> {
  const active = await getActiveClinicId(supabase);
  const clinicId = active?.clinicId;

  if (!clinicId) {
    return emptyProfitStats();
  }

  const { fetchTotalRefundsAmount } = await import(
    "@/lib/services/session-refunds"
  );

  const [
    opsRes,
    expensesRes,
    salariesRes,
    shares,
    outstandingDebts,
    totalRefunds,
    clinicExpenseShare,
    balanceTopups,
  ] = await Promise.all([
    supabase
      .from("patient_operations")
      .select("paid_amount")
      .eq("clinic_id", clinicId),
    supabase.from("expenses").select("amount").eq("clinic_id", clinicId),
    supabase
      .from("salary_slips")
      .select("net_payout")
      .eq("clinic_id", clinicId)
      .eq("status", "paid"),
    fetchTreatmentLevelShares(supabase, clinicId),
    fetchOutstandingDebts(supabase, clinicId),
    fetchTotalRefundsAmount(supabase, { clinicId }),
    fetchClinicShareExpenseTotal(supabase, clinicId),
    fetchClinicBalanceTopupsTotal(supabase, clinicId),
  ]);

  const ops = opsRes.data ?? [];
  const cashInflow = ops.reduce((s, r) => s + Number(r.paid_amount ?? 0), 0);
  const { clinicShareTotal, doctorShareTotal } = shares;
  const generalExpenses = (expensesRes.data ?? []).reduce(
    (s, r) => s + Number(r.amount ?? 0),
    0
  );
  const totalExpenses = generalExpenses + clinicExpenseShare;
  const totalSalariesPaid = (salariesRes.data ?? []).reduce(
    (s, r) => s + Number(r.net_payout ?? 0),
    0
  );

  calculateClinicProfit({
    clinicShareFromOperations: clinicShareTotal,
    totalOutstandingDebts: outstandingDebts,
    totalStaffSalaries: totalSalariesPaid,
    totalExpenses,
    cashCollected: cashInflow,
    doctorShareAccrued: doctorShareTotal,
  });

  const refundsRounded = Math.round(totalRefunds * 100) / 100;
  // paid_amount يشمل قيود الإرجاع السالبة — لا نطرح session_refunds مرة ثانية
  const netProfit = Math.round(
    (cashInflow - totalExpenses - totalSalariesPaid + balanceTopups) * 100
  ) / 100;

  return {
    cashInflow,
    outstandingDebts,
    netProfit,
    totalRefunds: refundsRounded,
    clinicShareTotal,
    doctorShareTotal,
    totalExpenses,
    totalSalariesPaid,
    breakdown: [
      { label: "صافي المحصّل (بعد المرتجعات)", amount: cashInflow },
      ...(balanceTopups > 0
        ? [{ label: "شحن رصيد العيادة", amount: balanceTopups }]
        : []),
      { label: "صرفيات العيادة", amount: -generalExpenses },
      {
        label: "حصة العيادة من صرفيات الأطباء",
        amount: -clinicExpenseShare,
      },
      { label: "رواتب مدفوعة", amount: -totalSalariesPaid },
      { label: "حصة العيادة من العمليات", amount: clinicShareTotal },
      { label: "أرباح الأطباء (محافظ — منفصلة)", amount: doctorShareTotal },
      { label: "صافي ربح العيادة", amount: netProfit },
    ],
  };
}

export async function fetchDoctorWithdrawableBalance(
  supabase: SupabaseClient,
  doctorId: string
): Promise<number> {
  const { fetchDoctorWalletStats } = await import("@/lib/services/doctor-wallet");
  const stats = await fetchDoctorWalletStats(supabase, doctorId);
  return stats.availableBalance;
}

export async function fetchDoctorWithdrawLimit(
  supabase: SupabaseClient,
  doctorId: string
): Promise<number> {
  const { fetchDoctorWithdrawableLimit } = await import(
    "@/lib/services/doctor-wallet"
  );
  return fetchDoctorWithdrawableLimit(supabase, doctorId);
}

export async function notifyAccountantsWithdrawal(
  supabase: SupabaseClient,
  clinicId: string,
  doctorName: string,
  amount: number
) {
  const { data: accountants } = await supabase
    .from("profiles")
    .select("id")
    .eq("clinic_id", clinicId)
    .in("role", ["accountant", "super_admin"]);

  if (!accountants?.length) return;

  await supabase.from("notifications").insert(
    accountants.map((a) => ({
      clinic_id: clinicId,
      recipient_profile_id: a.id,
      title_ar: "طلب سحب من طبيب",
      body_ar: `طلب ${doctorName} سحب مبلغ ${formatCurrency(amount)}`,
      link_path: "/dashboard/withdrawals",
    }))
  );
}

export async function fetchUnreadNotificationCount(
  supabase: SupabaseClient,
  profileId: string
): Promise<number> {
  const { count } = await supabase
    .from("notifications")
    .select("*", { count: "exact", head: true })
    .eq("recipient_profile_id", profileId)
    .eq("is_read", false);

  return count ?? 0;
}
