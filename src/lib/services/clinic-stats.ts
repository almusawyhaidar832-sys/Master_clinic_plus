import type { SupabaseClient } from "@supabase/supabase-js";
import { getActiveClinicId } from "@/lib/clinic-context";
import { fetchClinicBalanceTopupsForPeriod } from "@/lib/services/balance-topup";
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
  reviewFeesTotal: number;
  balanceTopupsTotal: number;
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

  const { loadOperationsInPeriod, fetchPeriodVisitorDebt } = await import(
    "@/lib/services/executive-snapshot"
  );

  const [visitorResult, ops] = await Promise.all([
    fetchPeriodVisitorDebt(supabase, active.clinicId, date, date),
    loadOperationsInPeriod(supabase, active.clinicId, date, date),
  ]);

  return {
    operationsCount: ops.length,
    totalRemainingDebt: visitorResult.debt,
    totalCollected: ops.reduce(
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
  reviewFeesTotal: 0,
  balanceTopupsTotal: 0,
  totalExpenses: 0,
  totalSalariesPaid: 0,
  breakdown: [],
});

function roundProfitMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

const BALANCE_TOPUP_LABEL = "شحن رصيد العيادة";
const NET_PROFIT_LABEL = "صافي ربح العيادة";

export interface PendingClinicTopUpProfit {
  minTopups: number;
  minNetProfit: number;
}

/** تحديث فوري لصافي الربح بعد شحن رصيد العيادة ضمن الفترة المعروضة */
export function applyClinicTopUpToProfitStats(
  stats: ClinicProfitStats,
  amount: number
): ClinicProfitStats {
  const balanceTopupsTotal = roundProfitMoney(stats.balanceTopupsTotal + amount);
  const netProfit = roundProfitMoney(stats.netProfit + amount);
  const breakdown = [...stats.breakdown];

  const topupIdx = breakdown.findIndex((r) => r.label === BALANCE_TOPUP_LABEL);
  if (topupIdx >= 0) {
    breakdown[topupIdx] = { ...breakdown[topupIdx], amount: balanceTopupsTotal };
  } else {
    const expenseIdx = breakdown.findIndex((r) => r.label === "صرفيات العيادة");
    const insertAt = expenseIdx >= 0 ? expenseIdx : breakdown.length - 1;
    breakdown.splice(insertAt, 0, {
      label: BALANCE_TOPUP_LABEL,
      amount: balanceTopupsTotal,
    });
  }

  const netIdx = breakdown.findIndex((r) => r.label === NET_PROFIT_LABEL);
  if (netIdx >= 0) {
    breakdown[netIdx] = { ...breakdown[netIdx], amount: netProfit };
  }

  return { ...stats, balanceTopupsTotal, netProfit, breakdown };
}

/** دمج شحن معلّق حتى يعكس السيرفر المبلغ ضمن الفترة */
export function reconcilePendingClinicTopUpInProfitStats(
  stats: ClinicProfitStats,
  pending: PendingClinicTopUpProfit
): { stats: ClinicProfitStats; resolved: boolean } {
  const serverTopups = roundProfitMoney(stats.balanceTopupsTotal);
  const serverNet = roundProfitMoney(stats.netProfit);
  const topupsOk = serverTopups + 0.01 >= pending.minTopups;
  const netOk = serverNet + 0.01 >= pending.minNetProfit;

  if (topupsOk && netOk) {
    return { stats, resolved: true };
  }

  let next = stats;
  if (!topupsOk) {
    next = applyClinicTopUpToProfitStats(
      next,
      pending.minTopups - serverTopups
    );
  }
  if (!netOk) {
    const netProfit = roundProfitMoney(
      Math.max(next.netProfit, pending.minNetProfit)
    );
    next = {
      ...next,
      netProfit,
      breakdown: next.breakdown.map((row) =>
        row.label === NET_PROFIT_LABEL ? { ...row, amount: netProfit } : row
      ),
    };
  }
  return { stats: next, resolved: false };
}

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
  const { fetchResolvedSalaryDeductionForPeriod, loadOperationsInPeriod, fetchPeriodVisitorDebt } =
    await import("@/lib/services/executive-snapshot");
  const { fetchPeriodCollectionFinancialTotals } = await import(
    "@/lib/ledger/daily-collections"
  );

  const { fetchRegisteredAssistantPayrollClinicDeduction } = await import(
    "@/lib/ledger/daily-assistant-payroll"
  );

  const [
    ops,
    collectionFinancials,
    expensesRes,
    totalSalariesPaid,
    registeredAssistantClinic,
    totalRefunds,
    clinicExpenseShareRes,
    visitorDebt,
    balanceTopups,
  ] = await Promise.all([
    loadOperationsInPeriod(supabase, clinicId, from, to),
    fetchPeriodCollectionFinancialTotals(supabase, clinicId, from, to),
    supabase
      .from("expenses")
      .select("amount, expense_kind")
      .eq("clinic_id", clinicId)
      .gte("expense_date", from)
      .lte("expense_date", to),
    fetchResolvedSalaryDeductionForPeriod(supabase, clinicId, from, to),
    fetchRegisteredAssistantPayrollClinicDeduction(supabase, clinicId, from, to),
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
    fetchClinicBalanceTopupsForPeriod(supabase, clinicId, from, to),
  ]);

  const confirmedSalariesPaid = roundProfitMoney(
    totalSalariesPaid - registeredAssistantClinic
  );

  const cashInflow = roundProfitMoney(collectionFinancials.collected);
  const clinicShareTotal = roundProfitMoney(collectionFinancials.clinicShareTotal);
  const doctorShareTotal = roundProfitMoney(collectionFinancials.doctorShareTotal);
  const generalExpenses = roundProfitMoney(
    (expensesRes.data ?? [])
      .filter((r) => (r.expense_kind ?? "general") !== "doctor_salary")
      .reduce((s, r) => s + Number(r.amount ?? 0), 0)
  );
  const clinicExpenseShare = roundProfitMoney(
    (clinicExpenseShareRes.data ?? []).reduce(
      (s, row) => s + Math.abs(Number(row.amount ?? 0)),
      0
    )
  );
  const totalExpenses = roundProfitMoney(generalExpenses + clinicExpenseShare);
  const outstandingDebts = roundProfitMoney(visitorDebt.debt);
  const refundsRounded = roundProfitMoney(totalRefunds);
  const registeredAssistantClinicRounded = roundProfitMoney(registeredAssistantClinic);
  const totalSalariesPaidRounded = roundProfitMoney(totalSalariesPaid);
  const balanceTopupsRounded = roundProfitMoney(balanceTopups);
  const { loadClinicDefaultReviewFee, sumReviewFeesInOperations } =
    await import("@/lib/services/doctor-wallet");
  const clinicReviewFee = await loadClinicDefaultReviewFee(supabase, clinicId);
  const reviewFeesTotal = sumReviewFeesInOperations(ops, clinicReviewFee);
  /** حصة العيادة من الكشف المالي تتضمن الكشفيات — لا نجمعها مرة ثانية في الربح */
  const clinicShareFromTreatment = roundProfitMoney(
    Math.max(0, clinicShareTotal - reviewFeesTotal)
  );
  const netProfit = roundProfitMoney(
    clinicShareTotal -
      totalExpenses -
      totalSalariesPaidRounded +
      balanceTopupsRounded
  );

  return {
    cashInflow,
    outstandingDebts,
    netProfit,
    totalRefunds: refundsRounded,
    clinicShareTotal,
    doctorShareTotal,
    reviewFeesTotal,
    balanceTopupsTotal: balanceTopupsRounded,
    totalExpenses,
    totalSalariesPaid: totalSalariesPaidRounded,
    breakdown: [
      { label: "صافي المحصّل (بعد المرتجعات)", amount: cashInflow },
      { label: "حصة العيادة من العلاج", amount: clinicShareFromTreatment },
      ...(reviewFeesTotal > 0
        ? [{ label: "كشفيات المراجعين (ربح العيادة)", amount: reviewFeesTotal }]
        : []),
      ...(balanceTopupsRounded > 0
        ? [{ label: "شحن رصيد العيادة", amount: balanceTopupsRounded }]
        : []),
      { label: "صرفيات العيادة", amount: -generalExpenses },
      {
        label: "حصة العيادة من صرفيات الأطباء",
        amount: -clinicExpenseShare,
      },
      { label: "رواتب مؤكَّد صرفها", amount: -confirmedSalariesPaid },
      ...(registeredAssistantClinicRounded > 0
        ? [
            {
              label: "أجور مساعدين — مسجّلة (حصة العيادة)",
              amount: -registeredAssistantClinicRounded,
            },
          ]
        : []),
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

  /** نفس منطق الكشف المالي والتقرير الشهري — مصدر واحد للربح */
  return fetchClinicProfitStatsForPeriod(
    supabase,
    clinicId,
    "2000-01-01",
    todayISO()
  );
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
