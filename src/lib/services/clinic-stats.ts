import type { SupabaseClient } from "@supabase/supabase-js";
import { calculateClinicProfit } from "@/lib/finance";
import { todayISO } from "@/lib/utils";

export interface TodaySummary {
  operationsCount: number;
  totalRemainingDebt: number;
  totalCollected: number;
}

export interface ClinicProfitStats {
  cashInflow: number;
  outstandingDebts: number;
  netProfit: number;
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
  const { data } = await supabase
    .from("patient_operations")
    .select("paid_amount, remaining_debt")
    .eq("operation_date", today);

  const rows = data ?? [];
  return {
    operationsCount: rows.length,
    totalRemainingDebt: rows.reduce(
      (s, r) => s + Number(r.remaining_debt ?? 0),
      0
    ),
    totalCollected: rows.reduce((s, r) => s + Number(r.paid_amount ?? 0), 0),
  };
}

export async function fetchClinicProfitStats(
  supabase: SupabaseClient
): Promise<ClinicProfitStats> {
  const [
    opsRes,
    expensesRes,
    salariesRes,
    debtsRes,
  ] = await Promise.all([
    supabase
      .from("patient_operations")
      .select("paid_amount, remaining_debt, clinic_share_amount, doctor_share_amount"),
    supabase.from("expenses").select("amount"),
    supabase
      .from("salary_slips")
      .select("net_payout")
      .eq("status", "paid"),
    supabase
      .from("patient_operations")
      .select("remaining_debt")
      .gt("remaining_debt", 0),
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
  const totalExpenses = (expensesRes.data ?? []).reduce(
    (s, r) => s + Number(r.amount ?? 0),
    0
  );
  const totalSalariesPaid = (salariesRes.data ?? []).reduce(
    (s, r) => s + Number(r.net_payout ?? 0),
    0
  );
  const outstandingDebts = (debtsRes.data ?? []).reduce(
    (s, r) => s + Number(r.remaining_debt ?? 0),
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

  return {
    cashInflow,
    outstandingDebts,
    netProfit: profit.netProfit,
    clinicShareTotal,
    doctorShareTotal,
    totalExpenses,
    totalSalariesPaid,
    breakdown: [
      { label: "حصة العيادة من العمليات", amount: clinicShareTotal },
      { label: "المتحصل نقداً (مرضى)", amount: cashInflow },
      { label: "أرباح الأطباء (محافظ — منفصلة)", amount: doctorShareTotal },
      { label: "رواتب مدفوعة", amount: -totalSalariesPaid },
      { label: "مصروفات عامة", amount: -totalExpenses },
      { label: "صافي ربح العيادة", amount: profit.netProfit },
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
      body_ar: `طلب ${doctorName} سحب مبلغ ${amount} ج.م`,
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
