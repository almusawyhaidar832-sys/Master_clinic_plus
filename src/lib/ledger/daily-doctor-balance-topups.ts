import type { SupabaseClient } from "@supabase/supabase-js";
import { formatDoctorDisplayName } from "@/lib/services/clinic-profile";
import { BALANCE_TOPUP_DOCTOR_TYPE } from "@/lib/services/balance-topup";

export interface DoctorBalanceTopUpLine {
  id: string;
  doctorId: string;
  doctorName: string;
  amount: number;
  label: string;
  effectiveDate: string;
}

type TopUpDbRow = {
  id: string;
  doctor_id: string | null;
  amount: number | string;
  transaction_date: string;
  description_ar?: string | null;
  doctor?: { full_name_ar: string } | { full_name_ar: string }[] | null;
};

function relationName(
  rel: { full_name_ar: string } | { full_name_ar: string }[] | null | undefined
): string | undefined {
  if (!rel) return undefined;
  return Array.isArray(rel) ? rel[0]?.full_name_ar : rel.full_name_ar;
}

function mapTopUpLine(row: TopUpDbRow): DoctorBalanceTopUpLine | null {
  if (!row.doctor_id) return null;
  return {
    id: row.id,
    doctorId: row.doctor_id,
    doctorName: formatDoctorDisplayName(relationName(row.doctor) || "طبيب"),
    amount: Math.max(0, Number(row.amount ?? 0)),
    label: row.description_ar?.trim() || "شحن رصيد",
    effectiveDate: String(row.transaction_date).slice(0, 10),
  };
}

/** شحن رصيد الأطباء ضمن فترة الكشف */
export async function fetchDailyDoctorBalanceTopUpLines(
  supabase: SupabaseClient,
  clinicId: string,
  opts: { dateFrom: string; dateTo: string; doctorId?: string }
): Promise<DoctorBalanceTopUpLine[]> {
  let query = supabase
    .from("transactions")
    .select(
      "id, doctor_id, amount, transaction_date, description_ar, doctor:doctors!doctor_id(full_name_ar)"
    )
    .eq("clinic_id", clinicId)
    .eq("type", BALANCE_TOPUP_DOCTOR_TYPE)
    .gt("amount", 0)
    .gte("transaction_date", opts.dateFrom)
    .lte("transaction_date", opts.dateTo)
    .not("doctor_id", "is", null)
    .order("transaction_date", { ascending: false });

  if (opts.doctorId) {
    query = query.eq("doctor_id", opts.doctorId);
  }

  const { data, error } = await query;
  if (error) return [];

  return (data ?? [])
    .map((row) => mapTopUpLine(row as TopUpDbRow))
    .filter((line): line is DoctorBalanceTopUpLine => line != null);
}

export function sumBalanceTopUpsByDoctor(
  lines: DoctorBalanceTopUpLine[]
): Map<string, number> {
  const map = new Map<string, number>();
  for (const line of lines) {
    map.set(
      line.doctorId,
      roundMoney((map.get(line.doctorId) ?? 0) + line.amount)
    );
  }
  return map;
}

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}
