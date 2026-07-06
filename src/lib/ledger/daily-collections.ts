import type { SupabaseClient } from "@supabase/supabase-js";
import { FINANCIAL_EPSILON } from "@/lib/services/patient-financial-plan";
import {
  fetchLedgerOperationsForDate,
  ledgerDisplayRemaining,
  ledgerPaidToday,
  sessionKindLabel,
  type TodayOperationRow,
} from "@/lib/ledger/today-operations";
import {
  sumPatientDebtFromCases,
  type DebtorCaseDetail,
} from "@/lib/ledger/outstanding-debt";
import { computeVisitDoctorShare } from "@/lib/services/doctor-wallet";
import { isSalaryDoctor } from "@/lib/services/doctor-payment";
import {
  fetchDailyAssistantPayrollLines,
  sumAssistantPayrollByDoctor,
  type DailyAssistantPayrollLine,
} from "@/lib/ledger/daily-assistant-payroll";
import { getPatientDisplayPhone } from "@/lib/phone";
import { opName } from "@/types";
import { todayISO } from "@/lib/utils";

export type CollectionPaymentStatus =
  | "paid_full"
  | "partial"
  | "unpaid"
  | "at_accountant"
  | "in_visit"
  | "debtor";

export type CollectionStatusFilter =
  | "all"
  | "paid"
  | "unpaid"
  | "at_accountant"
  | "debtors";

export type DailyCollectionRow = {
  id: string;
  patientId: string | null;
  patientName: string;
  patientPhone: string | null;
  doctorId: string;
  doctorName: string;
  /** تاريخ الزيارة عند عرض فترة زمنية */
  visitDate: string | null;
  sessionLabel: string;
  /** مبلغ هذه الجلسة/السجل */
  paidToday: number;
  /** إجمالي ما دُفع لهذا المراجع عند هذا الطبيب في هذا اليوم */
  visitPaidToday: number;
  /** حصة الطبيب من مبلغ ما دفعه المراجع اليوم */
  visitDoctorShare: number;
  requiredToday: number;
  remaining: number;
  /** إجمالي الدين على المراجع (كل الحالات المفتوحة) */
  caseDebtTotal: number;
  debtCases: DebtorCaseDetail[];
  paymentStatus: CollectionPaymentStatus;
  queueEntryId: string | null;
  operationIds: string[];
};

export type DoctorDailySummary = {
  doctorId: string;
  doctorName: string;
  rows: DailyCollectionRow[];
  assistantPayroll: DailyAssistantPayrollLine[];
  stats: {
    totalPatients: number;
    paidFull: number;
    partial: number;
    unpaid: number;
    atAccountant: number;
    inVisit: number;
    debtors: number;
    totalCollected: number;
    totalRemaining: number;
    /** حصة الطبيب من مدفوعات المراجعين في هذا اليوم */
    doctorShareToday: number;
    /** ما يُخصم من الطبيب لأجور مساعديه */
    assistantDoctorDeduction: number;
    /** حصة العيادة من أجور المساعدين */
    assistantClinicShare: number;
    /** حصة الطبيب بعد خصم المساعدين */
    netDoctorShareToday: number;
  };
};

export type DailyCollectionsResult = {
  date: string;
  dateFrom: string;
  dateTo: string;
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
  queue_date: string;
  doctor?: { full_name_ar: string } | null;
};

function phoneFromPatientJoin(
  patient: TodayOperationRow["patient"] | null | undefined
): string | null {
  if (!patient || typeof patient !== "object") return null;
  return getPatientDisplayPhone(
    patient as { phone?: string | null; phone_number?: string | null }
  );
}

function sessionLabelFromOp(op: TodayOperationRow): string {
  if (num(op.remaining_debt) > 0 && num(op.paid_amount) <= 0) {
    return `${opName(op)} — تسجيل دين`;
  }
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

/** مفتاح موحّد — يمنع صفّين لنفس المراجع (مع/بدون patient_id) */
function canonicalVisitKey(input: {
  doctorId: string;
  patientId: string | null;
  patientName: string;
  day?: string;
}): string {
  const base = input.patientId
    ? `${input.doctorId}:${input.patientId}`
    : visitKey(input.doctorId, null, input.patientName);
  return input.day ? `${base}:${input.day}` : base;
}

function sumVisitPaidToday(
  operations: TodayOperationRow[],
  groupByDay: boolean
): Map<string, number> {
  const totals = new Map<string, number>();
  for (const op of operations) {
    const doctorId = op.doctor_id;
    if (!doctorId) continue;
    const patientId = op.patient_id ?? null;
    const patientName = op.patient?.full_name_ar?.trim() || "مراجع";
    const paid = ledgerPaidToday(op);
    if (paid <= FINANCIAL_EPSILON) continue;
    const key = canonicalVisitKey({
      doctorId,
      patientId,
      patientName,
      day: groupByDay ? op.operation_date ?? undefined : undefined,
    });
    totals.set(key, (totals.get(key) ?? 0) + paid);
  }
  return totals;
}

function resolvePaymentStatus(input: {
  paidToday: number;
  visitPaidToday: number;
  remaining: number;
  caseDebtTotal: number;
  requiredToday: number;
  queueStatus: string | null;
  hasOperation: boolean;
}): CollectionPaymentStatus {
  const { paidToday, visitPaidToday, remaining, caseDebtTotal, requiredToday, queueStatus, hasOperation } =
    input;
  const paid = Math.max(paidToday, visitPaidToday);
  const debt = Math.max(remaining, caseDebtTotal);

  if (debt > FINANCIAL_EPSILON) {
    if (paid > FINANCIAL_EPSILON) {
      return "debtor";
    }
    if (
      queueStatus === "ready_for_billing" ||
      queueStatus === "ready_for_payment"
    ) {
      return "at_accountant";
    }
    return "debtor";
  }

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

type DoctorPaymentMeta = {
  pct: number;
  salary: boolean;
};

function computeVisitDoctorShares(
  operations: TodayOperationRow[],
  visitPaidByKey: Map<string, number>,
  metaByDoctor: Map<string, DoctorPaymentMeta>,
  groupByDay: boolean
): { byDoctor: Map<string, number>; byVisit: Map<string, number> } {
  const groups = new Map<
    string,
    { doctorId: string; vk: string; ops: TodayOperationRow[] }
  >();

  for (const op of operations) {
    const doctorId = op.doctor_id;
    if (!doctorId) continue;
    if (ledgerPaidToday(op) <= FINANCIAL_EPSILON) continue;

    const vk = canonicalVisitKey({
      doctorId,
      patientId: op.patient_id ?? null,
      patientName: op.patient?.full_name_ar?.trim() || "مراجع",
      day: groupByDay ? op.operation_date ?? undefined : undefined,
    });
    const groupKey = `${doctorId}\0${vk}`;
    const existing = groups.get(groupKey);
    if (existing) {
      existing.ops.push(op);
    } else {
      groups.set(groupKey, { doctorId, vk, ops: [op] });
    }
  }

  const byDoctor = new Map<string, number>();
  const byVisit = new Map<string, number>();
  for (const { doctorId, vk, ops } of groups.values()) {
    const meta = metaByDoctor.get(doctorId) ?? { pct: 0.5, salary: false };
    const visitPaid = visitPaidByKey.get(vk) ?? 0;
    const earned = computeVisitDoctorShare(
      ops,
      meta.pct,
      visitPaid,
      meta.salary
    );
    byVisit.set(vk, earned);
    byDoctor.set(doctorId, (byDoctor.get(doctorId) ?? 0) + earned);
  }
  return { byDoctor, byVisit };
}

function emptyStats(): DoctorDailySummary["stats"] {
  return {
    totalPatients: 0,
    paidFull: 0,
    partial: 0,
    unpaid: 0,
    atAccountant: 0,
    inVisit: 0,
    debtors: 0,
    totalCollected: 0,
    totalRemaining: 0,
    doctorShareToday: 0,
    assistantDoctorDeduction: 0,
    assistantClinicShare: 0,
    netDoctorShareToday: 0,
  };
}

function computeStats(
  rows: DailyCollectionRow[],
  groupByDay: boolean
): DoctorDailySummary["stats"] {
  const stats = emptyStats();
  stats.totalPatients = rows.length;

  const visitCollected = new Map<string, number>();
  for (const row of rows) {
    stats.totalRemaining += row.remaining;
    const vk = canonicalVisitKey({
      doctorId: row.doctorId,
      patientId: row.patientId,
      patientName: row.patientName,
      day: groupByDay ? row.visitDate ?? undefined : undefined,
    });
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
      case "debtor":
        stats.debtors += 1;
        if (row.visitPaidToday > FINANCIAL_EPSILON) {
          stats.partial += 1;
        }
        break;
    }
  }

  stats.totalCollected = [...visitCollected.values()].reduce((s, n) => s + n, 0);
  stats.doctorShareToday = rows.reduce((s, r) => s + r.visitDoctorShare, 0);
  stats.netDoctorShareToday = Math.max(
    0,
    roundMoney(stats.doctorShareToday - stats.assistantDoctorDeduction)
  );

  return stats;
}

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

function applyAssistantPayrollToStats(
  stats: DoctorDailySummary["stats"],
  assistant: {
    doctorDeduction: number;
    clinicShare: number;
  }
): void {
  stats.assistantDoctorDeduction = assistant.doctorDeduction;
  stats.assistantClinicShare = assistant.clinicShare;
  stats.netDoctorShareToday = Math.max(
    0,
    roundMoney(stats.doctorShareToday - stats.assistantDoctorDeduction)
  );
}

/** صف واحد لكل مراجع + طبيب في اليوم — بدل تكرار الاسم لكل سجل */
function mergeRowsByVisit(
  rows: DailyCollectionRow[],
  groupByDay: boolean
): DailyCollectionRow[] {
  const groups = new Map<string, DailyCollectionRow[]>();

  for (const row of rows) {
    const key = canonicalVisitKey({
      doctorId: row.doctorId,
      patientId: row.patientId,
      patientName: row.patientName,
      day: groupByDay ? row.visitDate ?? undefined : undefined,
    });
    const list = groups.get(key) ?? [];
    list.push(row);
    groups.set(key, list);
  }

  const merged: DailyCollectionRow[] = [];

  for (const [key, group] of groups) {
    if (group.length === 1) {
      merged.push(group[0]!);
      continue;
    }

    const sorted = [...group].sort((a, b) => b.paidToday - a.paidToday);
    const primary = sorted[0]!;
    const visitPaidToday = Math.max(...group.map((r) => r.visitPaidToday));
    const visitDoctorShare = Math.max(...group.map((r) => r.visitDoctorShare));
    const paidToday = group.reduce((s, r) => s + r.paidToday, 0);
    const remaining = Math.max(...group.map((r) => r.remaining));
    const caseDebtTotal = Math.max(...group.map((r) => r.caseDebtTotal));
    const requiredToday = Math.max(...group.map((r) => r.requiredToday));
    const operationIds = [
      ...new Set(group.flatMap((r) => r.operationIds)),
    ];
    const debtCases = [
      ...new Map(
        group
          .flatMap((r) => r.debtCases)
          .map((c) => [c.treatmentName, c] as const)
      ).values(),
    ];
    const patientPhone =
      group.find((r) => r.patientPhone)?.patientPhone ?? null;
    const queueEntryId =
      group.find((r) => r.queueEntryId)?.queueEntryId ?? null;
    const hasOperation = operationIds.length > 0;
    const queueStatus = group.some((r) => r.paymentStatus === "at_accountant")
      ? "ready_for_billing"
      : group.some((r) => r.paymentStatus === "in_visit")
        ? "in_progress"
        : null;

    const sessionLabels = [
      ...new Set(group.map((r) => r.sessionLabel).filter(Boolean)),
    ];
    const sessionLabel =
      sessionLabels.length === 1
        ? sessionLabels[0]!
        : `${primary.sessionLabel} (+${sessionLabels.length - 1} سجل)`;

    merged.push({
      id: `visit-${key}`,
      patientId: group.find((r) => r.patientId)?.patientId ?? primary.patientId,
      patientName: primary.patientName,
      patientPhone,
      doctorId: primary.doctorId,
      doctorName: primary.doctorName,
      visitDate: groupByDay ? primary.visitDate : null,
      sessionLabel,
      paidToday: paidToday > 0 ? paidToday : primary.paidToday,
      visitPaidToday,
      visitDoctorShare,
      requiredToday,
      remaining,
      caseDebtTotal,
      debtCases,
      paymentStatus: resolvePaymentStatus({
        paidToday: Math.max(paidToday, visitPaidToday),
        visitPaidToday,
        remaining,
        caseDebtTotal,
        requiredToday,
        queueStatus,
        hasOperation,
      }),
      queueEntryId,
      operationIds,
    });
  }

  return merged;
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
  target.debtors += source.debtors;
  target.totalCollected += source.totalCollected;
  target.totalRemaining += source.totalRemaining;
  target.doctorShareToday += source.doctorShareToday;
  target.assistantDoctorDeduction += source.assistantDoctorDeduction;
  target.assistantClinicShare += source.assistantClinicShare;
  target.netDoctorShareToday += source.netDoctorShareToday;
}

export function matchesCollectionFilter(
  status: CollectionPaymentStatus,
  filter: CollectionStatusFilter,
  visitPaidToday = 0
): boolean {
  if (filter === "all") return true;
  if (filter === "paid") {
    return (
      status === "paid_full" ||
      status === "partial" ||
      (status === "debtor" && visitPaidToday > FINANCIAL_EPSILON)
    );
  }
  if (filter === "unpaid") {
    return status === "unpaid";
  }
  if (filter === "at_accountant") {
    return status === "at_accountant";
  }
  if (filter === "debtors") {
    return status === "debtor";
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
    case "debtor":
      return "مديون";
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
    case "debtor":
      return "bg-orange-100 text-orange-900 ring-1 ring-orange-300 font-bold";
    default:
      return "bg-slate-100 text-slate-600";
  }
}

export async function fetchDailyCollections(
  supabase: SupabaseClient,
  clinicId: string,
  input: {
    date?: string;
    dateFrom?: string;
    dateTo?: string;
    doctorId?: string;
    statusFilter?: CollectionStatusFilter;
  }
): Promise<DailyCollectionsResult> {
  const statusFilter = input.statusFilter ?? "all";
  const dateFrom = input.dateFrom ?? input.date ?? todayISO();
  const dateTo = input.dateTo ?? input.date ?? dateFrom;
  const effectiveTo = dateTo >= dateFrom ? dateTo : dateFrom;
  const effectiveFrom = dateFrom;
  const groupByDay = effectiveFrom !== effectiveTo;

  const [ledger, queueRes, doctorsRes] = await Promise.all([
    fetchLedgerOperationsForDate(supabase, clinicId, {
      dateFrom: effectiveFrom,
      dateTo: effectiveTo,
      doctorId: input.doctorId,
      limit: groupByDay ? 2000 : 500,
    }),
    fetchQueueForPeriod(supabase, clinicId, effectiveFrom, effectiveTo, input.doctorId),
    supabase
      .from("doctors")
      .select("id, full_name_ar, percentage, payment_type, financial_agreement")
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
  const visitPaidByKey = sumVisitPaidToday(operations, groupByDay);
  const patientDebtMap = sumPatientDebtFromCases(caseInfoById);

  const metaByDoctor = new Map<string, DoctorPaymentMeta>();
  for (const doc of doctorsRes.data ?? []) {
    metaByDoctor.set(String(doc.id), {
      pct: Number(doc.percentage ?? 50) / 100,
      salary: isSalaryDoctor({
        payment_type: doc.payment_type,
        financial_agreement: doc.financial_agreement,
      }),
    });
  }
  if (input.doctorId && !metaByDoctor.has(input.doctorId)) {
    const { data: doc } = await supabase
      .from("doctors")
      .select("id, percentage, payment_type, financial_agreement")
      .eq("id", input.doctorId)
      .maybeSingle();
    if (doc) {
      metaByDoctor.set(input.doctorId, {
        pct: Number(doc.percentage ?? 50) / 100,
        salary: isSalaryDoctor({
          payment_type: doc.payment_type,
          financial_agreement: doc.financial_agreement,
        }),
      });
    }
  }
  const { byVisit: visitDoctorShareByKey } = computeVisitDoctorShares(
    operations,
    visitPaidByKey,
    metaByDoctor,
    groupByDay
  );

  const assistantPayrollLines = await fetchDailyAssistantPayrollLines(
    supabase,
    clinicId,
    { dateFrom: effectiveFrom, dateTo: effectiveTo },
    input.doctorId
  );
  const assistantByDoctor = sumAssistantPayrollByDoctor(assistantPayrollLines);
  const assistantLinesByDoctor = new Map<string, DailyAssistantPayrollLine[]>();
  for (const line of assistantPayrollLines) {
    const list = assistantLinesByDoctor.get(line.doctorId) ?? [];
    list.push(line);
    assistantLinesByDoctor.set(line.doctorId, list);
  }

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

    const opDate = op.operation_date ?? effectiveFrom;
    const vk = canonicalVisitKey({
      doctorId,
      patientId,
      patientName,
      day: groupByDay ? opDate : undefined,
    });
    const visitPaidToday = visitPaidByKey.get(vk) ?? paidToday;

    const patientDebt = patientId ? patientDebtMap.get(patientId) : undefined;
    const caseDebtTotal = patientDebt?.total ?? remaining;
    const debtCases: DebtorCaseDetail[] =
      patientDebt?.cases.map((c) => ({
        caseId: "",
        treatmentName: c.name,
        totalPaid: 0,
        debt: c.remaining,
      })) ?? [];

    const paymentStatus = resolvePaymentStatus({
      paidToday,
      visitPaidToday,
      remaining,
      caseDebtTotal,
      requiredToday,
      queueStatus: queue?.status ?? null,
      hasOperation: true,
    });

    sessionRows.push({
      id: `op-${op.id}`,
      patientId,
      patientName,
      patientPhone:
        queue?.patient_phone?.trim() ||
        phoneFromPatientJoin(op.patient) ||
        null,
      doctorId,
      doctorName: op.doctor?.full_name_ar?.trim() || "طبيب",
      visitDate: groupByDay ? opDate : null,
      sessionLabel: sessionLabelFromOp(op),
      paidToday,
      visitPaidToday,
      visitDoctorShare: visitDoctorShareByKey.get(vk) ?? 0,
      requiredToday,
      remaining: Math.max(remaining, caseDebtTotal),
      caseDebtTotal,
      debtCases,
      paymentStatus,
      queueEntryId: queue?.id ?? null,
      operationIds: [op.id],
    });
  }

  for (const entry of queueRes) {
    if (entry.status === "cancelled" || matchedQueueIds.has(entry.id)) continue;

    const patientName = entry.patient_name?.trim() || "مراجع";
    const entryDate = entry.queue_date;
    const vk = canonicalVisitKey({
      doctorId: entry.doctor_id,
      patientId: entry.patient_id,
      patientName,
      day: groupByDay ? entryDate : undefined,
    });
    const visitPaidToday = visitPaidByKey.get(vk) ?? 0;

    const paymentStatus = resolvePaymentStatus({
      paidToday: 0,
      visitPaidToday,
      remaining: 0,
      caseDebtTotal: 0,
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
      visitDate: groupByDay ? entryDate : null,
      sessionLabel: "زيارة",
      paidToday: 0,
      visitPaidToday,
      visitDoctorShare: visitDoctorShareByKey.get(vk) ?? 0,
      requiredToday: 0,
      remaining: 0,
      caseDebtTotal: 0,
      debtCases: [],
      paymentStatus,
      queueEntryId: entry.id,
      operationIds: [],
    });
  }

  const mergedSessionRows = mergeRowsByVisit(sessionRows, groupByDay);

  const allRows = mergedSessionRows
    .filter((row) =>
      matchesCollectionFilter(row.paymentStatus, statusFilter, row.visitPaidToday)
    )
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
        if (groupByDay) {
          const dateCmp = String(b.visitDate ?? "").localeCompare(
            String(a.visitDate ?? "")
          );
          if (dateCmp !== 0) return dateCmp;
        }
        const paidCmp = b.visitPaidToday - a.visitPaidToday;
        if (paidCmp !== 0) return paidCmp;
        return a.patientName.localeCompare(b.patientName, "ar");
      });
      const stats = computeStats(sorted, groupByDay);
      const assistantTotals = assistantByDoctor.get(doctorId);
      if (assistantTotals) {
        applyAssistantPayrollToStats(stats, assistantTotals);
      }
      return {
        doctorId,
        doctorName: doctorNameById.get(doctorId) ?? "طبيب",
        rows: sorted,
        assistantPayroll: assistantLinesByDoctor.get(doctorId) ?? [],
        stats,
      };
    })
    .sort((a, b) => a.doctorName.localeCompare(b.doctorName, "ar"));

  for (const doctorId of assistantByDoctor.keys()) {
    if (doctors.some((d) => d.doctorId === doctorId)) continue;
    const assistantTotals = assistantByDoctor.get(doctorId)!;
    const stats = emptyStats();
    applyAssistantPayrollToStats(stats, assistantTotals);
    doctors.push({
      doctorId,
      doctorName: doctorNameById.get(doctorId) ?? "طبيب",
      rows: [],
      assistantPayroll: assistantLinesByDoctor.get(doctorId) ?? [],
      stats,
    });
  }

  doctors.sort((a, b) => a.doctorName.localeCompare(b.doctorName, "ar"));

  const totals = emptyStats();
  for (const group of doctors) {
    mergeStats(totals, group.stats);
  }

  return {
    date: effectiveFrom,
    dateFrom: effectiveFrom,
    dateTo: effectiveTo,
    doctors,
    totals,
  };
}

async function fetchQueueForPeriod(
  supabase: SupabaseClient,
  clinicId: string,
  dateFrom: string,
  dateTo: string,
  doctorId?: string
): Promise<QueueRow[]> {
  let query = supabase
    .from("patient_queue")
    .select(
      "id, patient_id, patient_name, patient_phone, doctor_id, status, queue_date, doctor:doctors!doctor_id(full_name_ar)"
    )
    .eq("clinic_id", clinicId)
    .gte("queue_date", dateFrom)
    .lte("queue_date", dateTo)
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
      queue_date: String(r.queue_date ?? dateFrom),
      doctor,
    };
  });
}
