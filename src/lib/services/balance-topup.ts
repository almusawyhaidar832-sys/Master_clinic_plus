import type { SupabaseClient } from "@supabase/supabase-js";

export const BALANCE_TOPUP_CLINIC_TYPE = "balance_topup_clinic";
export const BALANCE_TOPUP_DOCTOR_TYPE = "balance_topup_doctor";

export type BalanceTopUpTarget = "clinic" | "doctor";

export interface BalanceTopUpSuccessDetail {
  target: BalanceTopUpTarget;
  amount: number;
  transactionDate: string;
  doctorId?: string | null;
  doctorWallet?: DoctorWalletSnapshot;
}

export interface DoctorWalletSnapshot {
  availableBalance: number;
  withdrawableLimit: number;
}

export interface ClinicBalanceTopUpLine {
  id: string;
  amount: number;
  label: string;
  effectiveDate: string;
}

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

/** شحن رصيد العيادة لفترة — آخر شحن ناجح فقط (لا يُجمع المحاولات المكررة) */
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
    .lte("transaction_date", to)
    .order("transaction_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data) return 0;
  return Math.round(Math.max(0, Number(data.amount ?? 0)) * 100) / 100;
}

/** سطور شحن رصيد العيادة ضمن فترة الكشف */
export async function fetchClinicBalanceTopUpLines(
  supabase: SupabaseClient,
  clinicId: string,
  opts: { dateFrom: string; dateTo: string }
): Promise<ClinicBalanceTopUpLine[]> {
  const { data, error } = await supabase
    .from("transactions")
    .select("id, amount, transaction_date, description_ar")
    .eq("clinic_id", clinicId)
    .eq("type", BALANCE_TOPUP_CLINIC_TYPE)
    .gt("amount", 0)
    .gte("transaction_date", opts.dateFrom)
    .lte("transaction_date", opts.dateTo)
    .order("transaction_date", { ascending: false });

  if (error) return [];

  return (data ?? []).map((row) => ({
    id: String(row.id),
    amount: Math.max(0, Number(row.amount ?? 0)),
    label: String(row.description_ar ?? "").trim() || "شحن رصيد العيادة",
    effectiveDate: String(row.transaction_date).slice(0, 10),
  }));
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
