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
  totalExpenses: 0,
  totalSalariesPaid: 0,
  breakdown: [],
});

function roundProfitMoney(n: number): number {
  return Math.round(n * 100) / 100;
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
  let reviewFeesTotal = 0;
  for (const row of ops) {
    const fee = Number(
      (row as unknown as Record<string, unknown>).review_fee_amount ?? 0
    );
    if (fee > 0) reviewFeesTotal += fee;
  }
  reviewFeesTotal = roundProfitMoney(reviewFeesTotal);
  const netProfit = roundProfitMoney(
    clinicShareTotal +
      reviewFeesTotal -
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
    totalExpenses,
    totalSalariesPaid: totalSalariesPaidRounded,
    breakdown: [
      { label: "صافي المحصّل (بعد المرتجعات)", amount: cashInflow },
      { label: "حصة العيادة من العمليات", amount: clinicShareTotal },
      ...(reviewFeesTotal > 0
        ? [{ label: "كشفيات المراجعين", amount: reviewFeesTotal }]
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
