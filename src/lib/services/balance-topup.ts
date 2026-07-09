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

function topupCalendarDay(value: unknown): string {
  return String(value ?? "").slice(0, 10);
}

function sumMaxTopupPerDayInRange(
  rows: Array<{ amount: unknown; day: string }>,
  from: string,
  to: string
): number {
  const maxByDay = new Map<string, number>();
  for (const row of rows) {
    const day = row.day;
    if (!day || day < from || day > to) continue;
    const amount = Math.max(0, Number(row.amount ?? 0));
    if (amount <= 0) continue;
    maxByDay.set(day, Math.max(maxByDay.get(day) ?? 0, amount));
  }

  const total = [...maxByDay.values()].reduce((sum, amount) => sum + amount, 0);
  return Math.round(total * 100) / 100;
}

/** شحن رصيد العيادة من موجز العمليات — احتياط إذا تعذّر قراءة transactions */
export async function fetchClinicBalanceTopupsFromAudit(
  supabase: SupabaseClient,
  clinicId: string,
  from: string,
  to: string
): Promise<number> {
  const { data, error } = await supabase
    .from("audit_logs")
    .select("financial_amount, after_data, changed_at")
    .eq("clinic_id", clinicId)
    .eq("entity_type", "financial_transaction")
    .eq("action", "create")
    .order("changed_at", { ascending: false })
    .limit(50);

  if (error || !data?.length) return 0;

  const rows: Array<{ amount: unknown; day: string }> = [];
  for (const entry of data) {
    const after = entry.after_data as Record<string, unknown> | null;
    if (!after) continue;
    if (
      after.type !== BALANCE_TOPUP_CLINIC_TYPE &&
      after.target !== "clinic"
    ) {
      continue;
    }

    rows.push({
      amount: entry.financial_amount ?? after.amount,
      day:
        topupCalendarDay(after.transaction_date) ||
        topupCalendarDay(entry.changed_at),
    });
  }

  return sumMaxTopupPerDayInRange(rows, from, to);
}

/**
 * أقوى مصدر لشحن الرصيد — transactions + audit + آخر حركات.
 * يُستخدم على السيرفر والإدارة لضمان تطابق الأجهزة.
 */
export async function fetchClinicBalanceTopupsAuthoritative(
  supabase: SupabaseClient,
  clinicId: string,
  from: string,
  to: string
): Promise<number> {
  const [fromTransactions, fromAudit, recentRows] = await Promise.all([
    fetchClinicBalanceTopupsForPeriod(supabase, clinicId, from, to),
    fetchClinicBalanceTopupsFromAudit(supabase, clinicId, from, to),
    supabase
      .from("transactions")
      .select("amount, transaction_date, created_at")
      .eq("clinic_id", clinicId)
      .eq("type", BALANCE_TOPUP_CLINIC_TYPE)
      .gt("amount", 0)
      .order("created_at", { ascending: false })
      .limit(30),
  ]);

  const fromRecent = sumMaxTopupPerDayInRange(
    (recentRows.data ?? []).map((row) => ({
      amount: row.amount,
      day:
        topupCalendarDay(row.transaction_date) ||
        topupCalendarDay(row.created_at),
    })),
    from,
    to
  );

  return Math.max(fromTransactions, fromAudit, fromRecent);
}

/** شحن رصيد العيادة لفترة — أعلى شحن لكل يوم (يتجاهل تكرار المحاولات) */
export async function fetchClinicBalanceTopupsForPeriod(
  supabase: SupabaseClient,
  clinicId: string,
  from: string,
  to: string
): Promise<number> {
  const { data, error } = await supabase
    .from("transactions")
    .select("amount, transaction_date")
    .eq("clinic_id", clinicId)
    .eq("type", BALANCE_TOPUP_CLINIC_TYPE)
    .gt("amount", 0)
    .gte("transaction_date", from)
    .lte("transaction_date", to);

  if (error || !data?.length) return 0;

  const maxByDay = new Map<string, number>();
  for (const row of data) {
    const day = String(row.transaction_date ?? "").slice(0, 10);
    if (!day) continue;
    const amount = Math.max(0, Number(row.amount ?? 0));
    maxByDay.set(day, Math.max(maxByDay.get(day) ?? 0, amount));
  }

  const total = [...maxByDay.values()].reduce((sum, amount) => sum + amount, 0);
  return Math.round(total * 100) / 100;
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
