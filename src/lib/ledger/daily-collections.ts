import type { SupabaseClient } from "@supabase/supabase-js";
import { FINANCIAL_EPSILON } from "@/lib/services/patient-financial-plan";
import {
  fetchLedgerOperationsForDate,
  ledgerDisplayRemaining,
  ledgerPaidToday,
  resolveOperationCaseId,
  sessionKindLabel,
  type TodayCaseInfo,
  type TodayOperationRow,
} from "@/lib/ledger/today-operations";
import { opName } from "@/types";

export type CollectionPaymentStatus =
  | "paid_full"
  | "partial"
  | "unpaid"
  | "at_accountant"
  | "in_visit";

export type CollectionStatusFilter =
  | "all"
  | "paid"
  | "unpaid"
  | "at_accountant";

export type DailyCollectionRow = {
  id: string;
  patientId: string | null;
  patientName: string;
  patientPhone: string | null;
  doctorId: string;
  doctorName: string;
  sessionLabel: string;
  paidToday: number;
  requiredToday: number;
  remaining: number;
  paymentStatus: CollectionPaymentStatus;
  queueEntryId: string | null;
  operationIds: string[];
};

export type DoctorDailySummary = {
  doctorId: string;
  doctorName: string;
  rows: DailyCollectionRow[];
  stats: {
    totalPatients: number;
    paidFull: number;
    partial: number;
    unpaid: number;
    atAccountant: number;
    inVisit: number;
    totalCollected: number;
    totalRemaining: number;
  };
};

export type DailyCollectionsResult = {
  date: string;
  doctors: DoctorDailySummary[];
  totals: DoctorDailySummary["stats"];
};

type QueueRow = {
  id: string;
  patient_id: string | null;
  patient_name: string | null;
  patient_phone: string | null;
  doctor_id: string;
  status: string;
  doctor?: { full_name_ar: string } | null;
};

type MutableRow = {
  patientId: string | null;
  patientName: string;
  patientPhone: string | null;
  doctorId: string;
  doctorName: string;
  paidToday: number;
  requiredToday: number;
  remaining: number;
  sessionLabels: string[];
  operationIds: string[];
  queueEntryId: string | null;
  queueStatus: string | null;
};

function num(v: unknown): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function rowKey(doctorId: string, patientId: string | null, patientName: string): string {
  const patientPart = patientId ?? patientName.trim().toLowerCase();
  return `${doctorId}:${patientPart}`;
}

function sessionLabelFromOp(op: TodayOperationRow): string {
  if (op.session_kind === "plan" || num(op.total_amount) > 0) {
    return opName(op);
  }
  return sessionKindLabel(op.session_kind);
}

function resolvePaymentStatus(row: MutableRow): CollectionPaymentStatus {
  const queueStatus = row.queueStatus ?? "";

  if (queueStatus === "ready_for_billing" || queueStatus === "ready_for_payment") {
    return "at_accountant";
  }

  if (
    queueStatus === "waiting" ||
    queueStatus === "called" ||
    queueStatus === "in_progress"
  ) {
    if (row.paidToday <= FINANCIAL_EPSILON && row.operationIds.length === 0) {
      return "in_visit";
    }
  }

  if (row.paidToday > FINANCIAL_EPSILON && row.remaining <= FINANCIAL_EPSILON) {
    return "paid_full";
  }

  if (row.paidToday > FINANCIAL_EPSILON && row.remaining > FINANCIAL_EPSILON) {
    return "partial";
  }

  if (
    row.paidToday <= FINANCIAL_EPSILON &&
    (row.queueStatus === "done" ||
      row.operationIds.length > 0 ||
      row.requiredToday > FINANCIAL_EPSILON)
  ) {
    return "unpaid";
  }

  if (row.operationIds.length === 0 && !row.queueStatus) {
    return "in_visit";
  }

  return "unpaid";
}

function emptyStats(): DoctorDailySummary["stats"] {
  return {
    totalPatients: 0,
    paidFull: 0,
    partial: 0,
    unpaid: 0,
    atAccountant: 0,
    inVisit: 0,
    totalCollected: 0,
    totalRemaining: 0,
  };
}

function computeStats(rows: DailyCollectionRow[]): DoctorDailySummary["stats"] {
  const stats = emptyStats();
  stats.totalPatients = rows.length;

  for (const row of rows) {
    stats.totalCollected += row.paidToday;
    stats.totalRemaining += row.remaining;

    switch (row.paymentStatus) {
      case "paid_full":
        stats.paidFull += 1;
        break;
      case "partial":
        stats.partial += 1;
        break;
      case "unpaid":
        stats.unpaid += 1;
        break;
      case "at_accountant":
        stats.atAccountant += 1;
        break;
      case "in_visit":
        stats.inVisit += 1;
        break;
    }
  }

  return stats;
}

function mergeStats(
  target: DoctorDailySummary["stats"],
  source: DoctorDailySummary["stats"]
): void {
  target.totalPatients += source.totalPatients;
  target.paidFull += source.paidFull;
  target.partial += source.partial;
  target.unpaid += source.unpaid;
  target.atAccountant += source.atAccountant;
  target.inVisit += source.inVisit;
  target.totalCollected += source.totalCollected;
  target.totalRemaining += source.totalRemaining;
}

export function matchesCollectionFilter(
  status: CollectionPaymentStatus,
  filter: CollectionStatusFilter
): boolean {
  if (filter === "all") return true;
  if (filter === "paid") {
    return status === "paid_full" || status === "partial";
  }
  if (filter === "unpaid") {
    return status === "unpaid";
  }
  if (filter === "at_accountant") {
    return status === "at_accountant";
  }
  return true;
}

export function collectionStatusLabel(status: CollectionPaymentStatus): string {
  switch (status) {
    case "paid_full":
      return "مدفوع بالكامل";
    case "partial":
      return "دفعة جزئية";
    case "unpaid":
      return "لم يدفع";
    case "at_accountant":
      return "عند المحاسب";
    case "in_visit":
      return "عند الطبيب";
    default:
      return "—";
  }
}

export function collectionStatusClass(status: CollectionPaymentStatus): string {
  switch (status) {
    case "paid_full":
      return "bg-emerald-100 text-emerald-800 ring-1 ring-emerald-200";
    case "partial":
      return "bg-amber-100 text-amber-800 ring-1 ring-amber-200";
    case "unpaid":
      return "bg-red-100 text-red-700 ring-1 ring-red-200";
    case "at_accountant":
      return "bg-violet-100 text-violet-800 ring-1 ring-violet-200";
    case "in_visit":
      return "bg-slate-100 text-slate-600 ring-1 ring-slate-200";
    default:
      return "bg-slate-100 text-slate-600";
  }
}

export async function fetchDailyCollections(
  supabase: SupabaseClient,
  clinicId: string,
  input: {
    date: string;
    doctorId?: string;
    statusFilter?: CollectionStatusFilter;
  }
): Promise<DailyCollectionsResult> {
  const statusFilter = input.statusFilter ?? "all";

  const [ledger, queueRes, doctorsRes] = await Promise.all([
    fetchLedgerOperationsForDate(supabase, clinicId, {
      date: input.date,
      doctorId: input.doctorId,
      limit: 500,
    }),
    fetchQueueForDate(supabase, clinicId, input.date, input.doctorId),
    input.doctorId
      ? Promise.resolve({ data: null })
      : supabase
          .from("doctors")
          .select("id, full_name_ar")
          .eq("clinic_id", clinicId)
          .eq("is_active", true)
          .order("full_name_ar"),
  ]);

  const {
    operations,
    caseRemainingById,
    caseInfoById,
    patientPrimaryCaseId,
  } = ledger;

  const rowMap = new Map<string, MutableRow>();

  for (const op of operations) {
    const doctorId = op.doctor_id;
    if (!doctorId) continue;

    const patientId = op.patient_id ?? null;
    const patientName =
      op.patient?.full_name_ar?.trim() || "مراجع";
    const key = rowKey(doctorId, patientId, patientName);

    const paid = ledgerPaidToday(op);
    const required =
      op.session_kind === "plan" || num(op.total_amount) > 0
        ? num(op.total_amount)
        : 0;
    const remaining = ledgerDisplayRemaining(
      op,
      caseRemainingById,
      patientPrimaryCaseId
    );
    const label = sessionLabelFromOp(op);

    const existing = rowMap.get(key);
    if (existing) {
      existing.paidToday += paid;
      existing.requiredToday += required;
      existing.remaining = Math.max(existing.remaining, remaining);
      if (label && !existing.sessionLabels.includes(label)) {
        existing.sessionLabels.push(label);
      }
      existing.operationIds.push(op.id);
      if (!existing.patientId && patientId) existing.patientId = patientId;
    } else {
      rowMap.set(key, {
        patientId,
        patientName,
        patientPhone: null,
        doctorId,
        doctorName: op.doctor?.full_name_ar?.trim() || "طبيب",
        paidToday: paid,
        requiredToday: required,
        remaining,
        sessionLabels: label ? [label] : [],
        operationIds: [op.id],
        queueEntryId: null,
        queueStatus: null,
      });
    }
  }

  for (const entry of queueRes) {
    const doctorId = entry.doctor_id;
    const patientId = entry.patient_id;
    const patientName = entry.patient_name?.trim() || "مراجع";
    const key = rowKey(doctorId, patientId, patientName);

    const existing = rowMap.get(key);
    if (existing) {
      existing.queueEntryId = entry.id;
      existing.queueStatus = entry.status;
      if (!existing.patientPhone && entry.patient_phone) {
        existing.patientPhone = entry.patient_phone;
      }
      if (!existing.patientId && patientId) {
        existing.patientId = patientId;
      }
    } else if (entry.status !== "cancelled") {
      rowMap.set(key, {
        patientId,
        patientName,
        patientPhone: entry.patient_phone,
        doctorId,
        doctorName: entry.doctor?.full_name_ar?.trim() || "طبيب",
        paidToday: 0,
        requiredToday: 0,
        remaining: 0,
        sessionLabels: [],
        operationIds: [],
        queueEntryId: entry.id,
        queueStatus: entry.status,
      });
    }
  }

  enrichRemainingFromCases(rowMap, patientPrimaryCaseId, caseInfoById, caseRemainingById);

  const allRows: DailyCollectionRow[] = [...rowMap.values()]
    .map((row) => {
      const paymentStatus = resolvePaymentStatus(row);
      return {
        id: rowKey(row.doctorId, row.patientId, row.patientName),
        patientId: row.patientId,
        patientName: row.patientName,
        patientPhone: row.patientPhone,
        doctorId: row.doctorId,
        doctorName: row.doctorName,
        sessionLabel: row.sessionLabels.join(" · ") || "زيارة",
        paidToday: row.paidToday,
        requiredToday: row.requiredToday,
        remaining: row.remaining,
        paymentStatus,
        queueEntryId: row.queueEntryId,
        operationIds: row.operationIds,
      };
    })
    .filter((row) => matchesCollectionFilter(row.paymentStatus, statusFilter))
    .filter((row) => row.paymentStatus !== "in_visit" || statusFilter === "all");

  const byDoctor = new Map<string, DailyCollectionRow[]>();
  for (const row of allRows) {
    const list = byDoctor.get(row.doctorId) ?? [];
    list.push(row);
    byDoctor.set(row.doctorId, list);
  }

  const doctorNameById = new Map<string, string>();
  for (const row of allRows) {
    doctorNameById.set(row.doctorId, row.doctorName);
  }
  for (const doc of doctorsRes.data ?? []) {
    doctorNameById.set(
      String(doc.id),
      String(doc.full_name_ar ?? "طبيب")
    );
  }

  if (input.doctorId && !byDoctor.has(input.doctorId)) {
    byDoctor.set(input.doctorId, []);
    if (!doctorNameById.has(input.doctorId)) {
      const { data: doc } = await supabase
        .from("doctors")
        .select("full_name_ar")
        .eq("id", input.doctorId)
        .maybeSingle();
      if (doc) {
        doctorNameById.set(input.doctorId, String(doc.full_name_ar));
      }
    }
  }

  const doctors: DoctorDailySummary[] = [...byDoctor.entries()]
    .map(([doctorId, rows]) => {
      const sorted = rows.sort((a, b) =>
        a.patientName.localeCompare(b.patientName, "ar")
      );
      return {
        doctorId,
        doctorName: doctorNameById.get(doctorId) ?? "طبيب",
        rows: sorted,
        stats: computeStats(sorted),
      };
    })
    .sort((a, b) => a.doctorName.localeCompare(b.doctorName, "ar"));

  const totals = emptyStats();
  for (const group of doctors) {
    mergeStats(totals, group.stats);
  }

  return {
    date: input.date,
    doctors,
    totals,
  };
}

async function fetchQueueForDate(
  supabase: SupabaseClient,
  clinicId: string,
  date: string,
  doctorId?: string
): Promise<QueueRow[]> {
  let query = supabase
    .from("patient_queue")
    .select(
      "id, patient_id, patient_name, patient_phone, doctor_id, status, doctor:doctors!doctor_id(full_name_ar)"
    )
    .eq("clinic_id", clinicId)
    .eq("queue_date", date)
    .neq("status", "cancelled");

  if (doctorId) {
    query = query.eq("doctor_id", doctorId);
  }

  const { data } = await query;
  return (data ?? []).map((row) => {
    const r = row as Record<string, unknown>;
    const doctorRaw = r.doctor;
    const doctor =
      doctorRaw && typeof doctorRaw === "object" && !Array.isArray(doctorRaw)
        ? (doctorRaw as { full_name_ar: string })
        : Array.isArray(doctorRaw) && doctorRaw[0]
          ? (doctorRaw[0] as { full_name_ar: string })
          : null;
    return {
      id: String(r.id),
      patient_id: (r.patient_id as string | null) ?? null,
      patient_name: (r.patient_name as string | null) ?? null,
      patient_phone: (r.patient_phone as string | null) ?? null,
      doctor_id: String(r.doctor_id),
      status: String(r.status),
      doctor,
    };
  });
}

function enrichRemainingFromCases(
  rowMap: Map<string, MutableRow>,
  patientPrimaryCaseId: Map<string, string>,
  caseInfoById: Map<string, TodayCaseInfo>,
  caseRemainingById: Map<string, number>
): void {
  for (const row of rowMap.values()) {
    if (row.remaining > FINANCIAL_EPSILON || !row.patientId) continue;

    const caseId = patientPrimaryCaseId.get(row.patientId);
    if (!caseId) continue;

    const remaining = caseRemainingById.get(caseId);
    if (remaining !== undefined) {
      row.remaining = remaining;
    }

    const info = caseInfoById.get(caseId);
    if (info && row.requiredToday <= FINANCIAL_EPSILON && info.finalPrice > 0) {
      row.requiredToday = info.finalPrice;
    }
  }
}
