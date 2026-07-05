import type { SupabaseClient } from "@supabase/supabase-js";
import { FINANCIAL_EPSILON } from "@/lib/services/patient-financial-plan";
import {
  fetchLedgerOperationsForDate,
  ledgerDisplayRemaining,
  ledgerPaidToday,
  sessionKindLabel,
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
  /** مبلغ هذه الجلسة/السجل */
  paidToday: number;
  /** إجمالي ما دُفع لهذا المراجع عند هذا الطبيب في هذا اليوم */
  visitPaidToday: number;
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

function sessionLabelFromOp(op: TodayOperationRow): string {
  if (op.session_kind === "plan" || num(op.total_amount) > 0) {
    return opName(op);
  }
  return sessionKindLabel(op.session_kind);
}

function buildQueueIndex(queueRows: QueueRow[]): Map<string, QueueRow[]> {
  const index = new Map<string, QueueRow[]>();
  const push = (key: string, entry: QueueRow) => {
    const list = index.get(key) ?? [];
    if (!list.some((e) => e.id === entry.id)) list.push(entry);
    index.set(key, list);
  };

  for (const entry of queueRows) {
    const name = entry.patient_name?.trim() || "مراجع";
    push(queueLookupKey(entry.doctor_id, null, name), entry);
    if (entry.patient_id) {
      push(`${entry.doctor_id}:${entry.patient_id}`, entry);
    }
  }
  return index;
}

function num(v: unknown): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function normalizePatientName(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

function rowKey(doctorId: string, patientId: string | null, patientName: string): string {
  const patientPart = patientId ?? normalizePatientName(patientName);
  return `${doctorId}:${patientPart}`;
}

function queueLookupKey(
  doctorId: string,
  patientId: string | null,
  patientName: string
): string {
  return rowKey(doctorId, patientId, patientName);
}

function namesRoughlyMatch(a: string, b: string): boolean {
  const na = normalizePatientName(a);
  const nb = normalizePatientName(b);
  return na === nb || na.includes(nb) || nb.includes(na);
}

function findQueueForOperation(
  op: TodayOperationRow,
  queueIndex: Map<string, QueueRow[]>
): QueueRow | null {
  const doctorId = op.doctor_id;
  const patientId = op.patient_id ?? null;
  const patientName = op.patient?.full_name_ar?.trim() || "مراجع";
  if (!doctorId) return null;

  if (patientId) {
    const byId = queueIndex.get(`${doctorId}:${patientId}`);
    if (byId?.length) return byId[0] ?? null;
  }

  const byName = queueIndex.get(queueLookupKey(doctorId, null, patientName));
  if (byName?.length) return byName[0] ?? null;

  const doctorQueues = [...queueIndex.entries()].filter(([key]) =>
    key.startsWith(`${doctorId}:`)
  );
  for (const [, entries] of doctorQueues) {
    for (const entry of entries) {
      if (patientId && entry.patient_id === patientId) return entry;
      if (namesRoughlyMatch(patientName, entry.patient_name ?? "")) return entry;
    }
  }

  return null;
}

function visitKey(
  doctorId: string,
  patientId: string | null,
  patientName: string
): string {
  return rowKey(doctorId, patientId, patientName);
}

function sumVisitPaidToday(
  operations: TodayOperationRow[]
): Map<string, number> {
  const totals = new Map<string, number>();
  for (const op of operations) {
    const doctorId = op.doctor_id;
    if (!doctorId) continue;
    const patientId = op.patient_id ?? null;
    const patientName = op.patient?.full_name_ar?.trim() || "مراجع";
    const paid = ledgerPaidToday(op);
    if (paid <= FINANCIAL_EPSILON) continue;
    const key = visitKey(doctorId, patientId, patientName);
    totals.set(key, (totals.get(key) ?? 0) + paid);
  }
  return totals;
}

function resolvePaymentStatus(input: {
  paidToday: number;
  visitPaidToday: number;
  remaining: number;
  requiredToday: number;
  queueStatus: string | null;
  hasOperation: boolean;
}): CollectionPaymentStatus {
  const { paidToday, visitPaidToday, remaining, requiredToday, queueStatus, hasOperation } =
    input;
  const paid = Math.max(paidToday, visitPaidToday);

  if (paid > FINANCIAL_EPSILON && remaining <= FINANCIAL_EPSILON) {
    return "paid_full";
  }

  if (paid > FINANCIAL_EPSILON && remaining > FINANCIAL_EPSILON) {
    return "partial";
  }

  if (queueStatus === "ready_for_billing" || queueStatus === "ready_for_payment") {
    return "at_accountant";
  }

  if (
    queueStatus === "waiting" ||
    queueStatus === "called" ||
    queueStatus === "in_progress"
  ) {
    if (!hasOperation && paid <= FINANCIAL_EPSILON) {
      return "in_visit";
    }
  }

  if (
    paid <= FINANCIAL_EPSILON &&
    (queueStatus === "done" ||
      hasOperation ||
      requiredToday > FINANCIAL_EPSILON)
  ) {
    return "unpaid";
  }

  if (!hasOperation && !queueStatus) {
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

  const visitCollected = new Map<string, number>();
  for (const row of rows) {
    stats.totalRemaining += row.remaining;
    const vk = visitKey(row.doctorId, row.patientId, row.patientName);
    visitCollected.set(vk, row.visitPaidToday);

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

  stats.totalCollected = [...visitCollected.values()].reduce((s, n) => s + n, 0);

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

  const queueIndex = buildQueueIndex(queueRes);
  const matchedQueueIds = new Set<string>();
  const visitPaidByKey = sumVisitPaidToday(operations);
  const sessionRows: DailyCollectionRow[] = [];

  for (const op of operations) {
    const doctorId = op.doctor_id;
    if (!doctorId) continue;

    const patientId = op.patient_id ?? null;
    const patientName = op.patient?.full_name_ar?.trim() || "مراجع";
    const paidToday = ledgerPaidToday(op);

    if (
      op.session_kind === "discount" &&
      paidToday <= FINANCIAL_EPSILON &&
      num(op.total_amount) <= FINANCIAL_EPSILON
    ) {
      continue;
    }

    const requiredToday =
      op.session_kind === "plan" || num(op.total_amount) > 0
        ? num(op.total_amount)
        : 0;
    let remaining = ledgerDisplayRemaining(
      op,
      caseRemainingById,
      patientPrimaryCaseId
    );

    const caseId =
      op.treatment_case_id?.trim() ||
      (patientId ? patientPrimaryCaseId.get(patientId) : null) ||
      null;
    if (caseId && caseRemainingById.has(caseId)) {
      remaining = Math.max(0, caseRemainingById.get(caseId)!);
    } else if (
      patientId &&
      remaining <= FINANCIAL_EPSILON &&
      caseInfoById.size > 0
    ) {
      const info = caseId ? caseInfoById.get(caseId) : undefined;
      if (info) {
        remaining = info.remaining;
        if (requiredToday <= FINANCIAL_EPSILON && info.finalPrice > 0) {
          // requiredToday stays from op when plan session exists
        }
      }
    }

    const queue = findQueueForOperation(op, queueIndex);
    if (queue) matchedQueueIds.add(queue.id);

    const vk = visitKey(doctorId, patientId, patientName);
    const visitPaidToday = visitPaidByKey.get(vk) ?? paidToday;

    const paymentStatus = resolvePaymentStatus({
      paidToday,
      visitPaidToday,
      remaining,
      requiredToday,
      queueStatus: queue?.status ?? null,
      hasOperation: true,
    });

    sessionRows.push({
      id: `op-${op.id}`,
      patientId,
      patientName,
      patientPhone: queue?.patient_phone ?? null,
      doctorId,
      doctorName: op.doctor?.full_name_ar?.trim() || "طبيب",
      sessionLabel: sessionLabelFromOp(op),
      paidToday,
      visitPaidToday,
      requiredToday,
      remaining,
      paymentStatus,
      queueEntryId: queue?.id ?? null,
      operationIds: [op.id],
    });
  }

  for (const entry of queueRes) {
    if (entry.status === "cancelled" || matchedQueueIds.has(entry.id)) continue;

    const patientName = entry.patient_name?.trim() || "مراجع";
    const vk = visitKey(entry.doctor_id, entry.patient_id, patientName);
    const visitPaidToday = visitPaidByKey.get(vk) ?? 0;

    const paymentStatus = resolvePaymentStatus({
      paidToday: 0,
      visitPaidToday,
      remaining: 0,
      requiredToday: 0,
      queueStatus: entry.status,
      hasOperation: false,
    });

    sessionRows.push({
      id: `queue-${entry.id}`,
      patientId: entry.patient_id,
      patientName,
      patientPhone: entry.patient_phone,
      doctorId: entry.doctor_id,
      doctorName: entry.doctor?.full_name_ar?.trim() || "طبيب",
      sessionLabel: "زيارة",
      paidToday: 0,
      visitPaidToday,
      requiredToday: 0,
      remaining: 0,
      paymentStatus,
      queueEntryId: entry.id,
      operationIds: [],
    });
  }

  const allRows = sessionRows
    .filter((row) => matchesCollectionFilter(row.paymentStatus, statusFilter))
    .filter(
      (row) => row.paymentStatus !== "in_visit" || statusFilter === "all"
    );

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
      const sorted = rows.sort((a, b) => {
        const paidCmp = b.visitPaidToday - a.visitPaidToday;
        if (paidCmp !== 0) return paidCmp;
        return a.patientName.localeCompare(b.patientName, "ar");
      });
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
