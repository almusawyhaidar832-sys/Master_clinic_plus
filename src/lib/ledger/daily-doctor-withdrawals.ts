import type { SupabaseClient } from "@supabase/supabase-js";
import { formatDoctorDisplayName } from "@/lib/services/clinic-profile";
import {
  filterWithdrawalsInPeriod,
  withdrawalEffectiveDate,
} from "@/lib/services/doctor-wallet";
import {
  type DoctorWithdrawalLine,
  withdrawalSourceLabel,
} from "@/lib/withdrawals/display";

/** يظهر في الكشف المالي — كل الحالات ما عدا المرفوض */
const STATEMENT_WITHDRAWAL_STATUSES = new Set([
  "pending",
  "approved",
  "paid",
]);

const CONFIRMED_WITHDRAWAL_STATUSES = new Set(["approved", "paid"]);

type WithdrawalDbRow = {
  id: string;
  doctor_id: string;
  amount: number | string;
  status: string;
  source?: string | null;
  requested_at: string;
  processed_at?: string | null;
  doctor?: { full_name_ar: string } | { full_name_ar: string }[] | null;
};

function relationName(
  rel: { full_name_ar: string } | { full_name_ar: string }[] | null | undefined
): string | undefined {
  if (!rel) return undefined;
  return Array.isArray(rel) ? rel[0]?.full_name_ar : rel.full_name_ar;
}

function mapWithdrawalLine(row: WithdrawalDbRow): DoctorWithdrawalLine {
  return {
    id: row.id,
    doctorId: row.doctor_id,
    doctorName: formatDoctorDisplayName(relationName(row.doctor) || "طبيب"),
    amount: Number(row.amount ?? 0),
    status: row.status,
    source: withdrawalSourceLabel(row.source),
    effectiveDate: withdrawalEffectiveDate(row),
  };
}

/** سحوبات الأطباء ضمن فترة الكشف — معلّقة أو موافق عليها أو مُصرفة */
export async function fetchDailyDoctorWithdrawalLines(
  supabase: SupabaseClient,
  clinicId: string,
  opts: { dateFrom: string; dateTo: string; doctorId?: string }
): Promise<DoctorWithdrawalLine[]> {
  const selectWithSource =
    "id, doctor_id, amount, status, source, requested_at, processed_at, doctor:doctors!doctor_id(full_name_ar)";
  const selectBase =
    "id, doctor_id, amount, status, requested_at, processed_at, doctor:doctors!doctor_id(full_name_ar)";

  let query = supabase
    .from("doctor_withdrawals")
    .select(selectWithSource)
    .eq("clinic_id", clinicId)
    .neq("status", "rejected")
    .order("requested_at", { ascending: false });

  if (opts.doctorId) {
    query = query.eq("doctor_id", opts.doctorId);
  }

  let { data, error } = await query;

  if (error?.message?.includes("source")) {
    let fallbackQuery = supabase
      .from("doctor_withdrawals")
      .select(selectBase)
      .eq("clinic_id", clinicId)
      .neq("status", "rejected")
      .order("requested_at", { ascending: false });
    if (opts.doctorId) {
      fallbackQuery = fallbackQuery.eq("doctor_id", opts.doctorId);
    }
    const fallback = await fallbackQuery;
    data = fallback.data as typeof data;
    error = fallback.error;
  }

  if (error) return [];

  const inPeriod = filterWithdrawalsInPeriod(data ?? [], {
    from: opts.dateFrom,
    to: opts.dateTo,
  }).filter((row) => STATEMENT_WITHDRAWAL_STATUSES.has(row.status));

  return inPeriod.map((row) => mapWithdrawalLine(row as WithdrawalDbRow));
}

function sumWithdrawalsByDoctorWithStatuses(
  lines: DoctorWithdrawalLine[],
  statuses: Set<string>
): Map<string, number> {
  const map = new Map<string, number>();
  for (const line of lines) {
    if (!statuses.has(line.status)) continue;
    map.set(
      line.doctorId,
      roundMoney((map.get(line.doctorId) ?? 0) + line.amount)
    );
  }
  return map;
}

/** مسحوب / موافق عليه خلال الفترة */
export function sumConfirmedWithdrawalsByDoctor(
  lines: DoctorWithdrawalLine[]
): Map<string, number> {
  return sumWithdrawalsByDoctorWithStatuses(lines, CONFIRMED_WITHDRAWAL_STATUSES);
}

/** طلبات سحب معلّقة خلال الفترة */
export function sumPendingWithdrawalsByDoctor(
  lines: DoctorWithdrawalLine[]
): Map<string, number> {
  return sumWithdrawalsByDoctorWithStatuses(lines, new Set(["pending"]));
}

/** @deprecated use sumConfirmedWithdrawalsByDoctor */
export function sumWithdrawalsByDoctor(
  lines: DoctorWithdrawalLine[]
): Map<string, number> {
  return sumConfirmedWithdrawalsByDoctor(lines);
}

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}
