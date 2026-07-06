import type { SupabaseClient } from "@supabase/supabase-js";

export const BALANCE_TOPUP_CLINIC_TYPE = "balance_topup_clinic";
export const BALANCE_TOPUP_DOCTOR_TYPE = "balance_topup_doctor";

export type BalanceTopUpTarget = "clinic" | "doctor";

function sumPositiveAmounts(
  rows: { amount: number | string }[] | null | undefined
): number {
  return Math.round(
    (rows ?? []).reduce((s, r) => s + Math.max(0, Number(r.amount ?? 0)), 0) *
      100
  ) / 100;
}

/** مجموع شحن رصيد الطبيب (كل الفترات) */
export async function fetchDoctorBalanceTopupsTotal(
  supabase: SupabaseClient,
  doctorId: string
): Promise<number> {
  const { data } = await supabase
    .from("transactions")
    .select("amount")
    .eq("doctor_id", doctorId)
    .eq("type", BALANCE_TOPUP_DOCTOR_TYPE)
    .gt("amount", 0);

  return sumPositiveAmounts(data);
}

/** شحن رصيد العيادة لفترة محددة */
export async function fetchClinicBalanceTopupsForPeriod(
  supabase: SupabaseClient,
  clinicId: string,
  from: string,
  to: string
): Promise<number> {
  const { data } = await supabase
    .from("transactions")
    .select("amount")
    .eq("clinic_id", clinicId)
    .eq("type", BALANCE_TOPUP_CLINIC_TYPE)
    .gt("amount", 0)
    .gte("transaction_date", from)
    .lte("transaction_date", to);

  return sumPositiveAmounts(data);
}

/** شحن رصيد العيادة — إجمالي */
export async function fetchClinicBalanceTopupsTotal(
  supabase: SupabaseClient,
  clinicId: string
): Promise<number> {
  const { data } = await supabase
    .from("transactions")
    .select("amount")
    .eq("clinic_id", clinicId)
    .eq("type", BALANCE_TOPUP_CLINIC_TYPE)
    .gt("amount", 0);

  return sumPositiveAmounts(data);
}

export function groupDoctorBalanceTopupsByDoctor(
  rows: { doctor_id: string; amount: number | string }[] | null | undefined
): Map<string, number> {
  const map = new Map<string, number>();
  for (const row of rows ?? []) {
    const id = row.doctor_id;
    map.set(
      id,
      Math.round(
        ((map.get(id) ?? 0) + Math.max(0, Number(row.amount ?? 0))) * 100
      ) / 100
    );
  }
  return map;
}
