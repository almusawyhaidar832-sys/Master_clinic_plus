import type { SupabaseClient } from "@supabase/supabase-js";
import { calculateClinicProfit } from "@/lib/finance";
import {
  fetchOutstandingDebts,
  fetchTreatmentLevelShares,
} from "@/lib/services/clinic-financial-aggregate";
import {
  fetchPeriodVisitorDebt,
  loadOperationsInPeriod,
} from "@/lib/services/executive-snapshot";
import { getActiveClinicId } from "@/lib/clinic-context";
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

export async function fetchTodaySummary(
  supabase: SupabaseClient
): Promise<TodaySummary> {
  const today = todayISO();
  const active = await getActiveClinicId(supabase);

  if (!active?.clinicId) {
    return { operationsCount: 0, totalRemainingDebt: 0, totalCollected: 0 };
  }

  const [visitorResult, operations] = await Promise.all([
    fetchPeriodVisitorDebt(supabase, active.clinicId, today, today),
    loadOperationsInPeriod(supabase, active.clinicId, today, today),
  ]);

  return {
    operationsCount: operations.length,
    totalRemainingDebt: visitorResult.debt,
    totalCollected: operations.reduce(
      (s, op) => s + Number(op.paid_amount ?? 0),
      0
    ),
  };
}

export async function fetchClinicProfitStats(
  supabase: SupabaseClient
): Promise<ClinicProfitStats> {
  const active = await getActiveClinicId(supabase);
  const clinicId = active?.clinicId;

  if (!clinicId) {
    return {
      cashInflow: 0,
      outstandingDebts: 0,
      netProfit: 0,
      totalRefunds: 0,
      clinicShareTotal: 0,
      doctorShareTotal: 0,
      totalExpenses: 0,
      totalSalariesPaid: 0,
      breakdown: [],
    };
  }

  const { fetchTotalRefundsAmount } = await import(
    "@/lib/services/session-refunds"
  );

  const [opsRes, expensesRes, salariesRes, shares, outstandingDebts, totalRefunds] =
    await Promise.all([
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
    ]);

  const ops = opsRes.data ?? [];
  const cashInflow = ops.reduce((s, r) => s + Number(r.paid_amount ?? 0), 0);
  const { clinicShareTotal, doctorShareTotal } = shares;
  const totalExpenses = (expensesRes.data ?? []).reduce(
    (s, r) => s + Number(r.amount ?? 0),
    0
  );
  const totalSalariesPaid = (salariesRes.data ?? []).reduce(
    (s, r) => s + Number(r.net_payout ?? 0),
    0
  );

  const profit = calculateClinicProfit({
    clinicShareFromOperations: clinicShareTotal,
    totalOutstandingDebts: outstandingDebts,
    totalStaffSalaries: totalSalariesPaid,
    totalExpenses,
    cashCollected: cashInflow,
    doctorShareAccrued: doctorShareTotal,
  });

  const refundsRounded = Math.round(totalRefunds * 100) / 100;
  const netProfit = Math.round(
    (cashInflow - refundsRounded - totalExpenses - totalSalariesPaid) * 100
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
      { label: "إجمالي الإيرادات (محصّل)", amount: cashInflow },
      { label: "المرتجعات", amount: -refundsRounded },
      { label: "مصروفات عامة", amount: -totalExpenses },
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
