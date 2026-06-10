import type { SupabaseClient } from "@supabase/supabase-js";
import {
  fetchDoctorWalletStats,
  fetchDoctorWalletStatsBatch,
} from "@/lib/services/doctor-wallet";

export interface DoctorAccountingBalance {
  doctorId: string;
  netBalance: number;
  isDebtor: boolean;
  totalEarnings: number;
  expenseDeductions: number;
  payrollDeductions: number;
}

/** رصيد محاسبي — يطابق الرصيد المتاح في السحب والمحفظة */
export async function fetchDoctorNetAccountingBalance(
  supabase: SupabaseClient,
  doctorId: string
): Promise<number> {
  const stats = await fetchDoctorWalletStats(supabase, doctorId);
  return stats.availableBalance;
}

export async function fetchDoctorAccountingBalances(
  supabase: SupabaseClient,
  doctorIds: string[]
): Promise<Map<string, DoctorAccountingBalance>> {
  const map = new Map<string, DoctorAccountingBalance>();
  if (!doctorIds.length) return map;

  const statsMap = await fetchDoctorWalletStatsBatch(supabase, doctorIds);

  for (const doctorId of doctorIds) {
    const stats = statsMap.get(doctorId);
    if (!stats) continue;
    map.set(doctorId, {
      doctorId,
      netBalance: stats.availableBalance,
      isDebtor: stats.isDebtor,
      totalEarnings: stats.totalEarnings,
      expenseDeductions: stats.expenseDeductions,
      payrollDeductions: stats.payrollDeductions,
    });
  }

  return map;
}
