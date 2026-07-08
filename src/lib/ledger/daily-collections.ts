import type { SupabaseClient } from "@supabase/supabase-js";
import { FINANCIAL_EPSILON, computeLiveDoctorShare, doctorPaymentPct } from "@/lib/services/patient-financial-plan";
import { CLINICAL_SESSION_LABEL } from "@/lib/clinical/constants";
import {
  fetchLedgerOperationsForDate,
  ledgerDisplayRemaining,
  ledgerPaidToday,
  sessionKindLabel,
  type TodayOperationRow,
} from "@/lib/ledger/today-operations";
import {
  normalizePatientNameForMatch,
} from "@/lib/services/resolve-patient-id";
import {
  sumPatientDebtFromCases,
  type DebtorCaseDetail,
} from "@/lib/ledger/outstanding-debt";
import {
  resolveReviewFeeOnOperation,
  treatmentPaidForDoctorShare,
  isReviewFeeOnlyPayment,
} from "@/lib/services/doctor-wallet";
import { isSalaryDoctor } from "@/lib/services/doctor-payment";
import { DOCTOR_FINANCE_WITH_NAME_SELECT } from "@/lib/services/doctor-db-select";
import {
  fetchDailyAssistantPayrollLines,
  sumAssistantPayrollByDoctor,
  type DailyAssistantPayrollLine,
} from "@/lib/ledger/daily-assistant-payroll";
import {
  fetchDailyDoctorWithdrawalLines,
  sumConfirmedWithdrawalsByDoctor,
  sumPendingWithdrawalsByDoctor,
} from "@/lib/ledger/daily-doctor-withdrawals";
import {
  fetchDailyDoctorBalanceTopUpLines,
  sumBalanceTopUpsByDoctor,
  type DoctorBalanceTopUpLine,
} from "@/lib/ledger/daily-doctor-balance-topups";
import {
  fetchDailyClinicExpenseLines,
  fetchDailyDoctorExpenseLines,
  sumClinicGeneralExpenses,
  sumDoctorExpenseDeductions,
  type DailyClinicExpenseLine,
  type DailyDoctorExpenseLine,
} from "@/lib/ledger/daily-statement-expenses";
import { fetchDoctorWalletStatsBatch } from "@/lib/services/doctor-wallet";
import type { DoctorWithdrawalLine } from "@/lib/withdrawals/display";
import { getPatientDisplayPhone } from "@/lib/phone";
import { opName, type Doctor } from "@/types";
import { formatCurrency, todayISO } from "@/lib/utils";

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
  withdrawals: DoctorWithdrawalLine[];
  balanceTopups: DoctorBalanceTopUpLine[];
  doctorExpenses: DailyDoctorExpenseLine[];
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
    /** خصم فواتير الصرفية من محفظة الطبيب */
    totalDoctorExpenseDeduction: number;
    /** حصة العيادة من فواتير صرفية هذا الطبيب */
    totalDoctorExpenseClinicShare: number;
    /** مسحوب / موافق عليه خلال الفترة */
    totalWithdrawnInPeriod: number;
    /** طلبات سحب معلّقة خلال الفترة */
    totalPendingWithdrawalInPeriod: number;
    /** شحن رصيد خلال الفترة */
    totalToppedUpInPeriod: number;
    /** الرصيد المحاسبي الحالي للطبيب بعد كل الصرفيات */
    availableBalance: number | null;
    /** أقصى مبلغ يمكن سحبه الآن (بعد حجز الطلبات المعلّقة) */
    withdrawableLimit: number | null;
  };
};

export type DailyCollectionsResult = {
  date: string;
  dateFrom: string;
  dateTo: string;
  doctors: DoctorDailySummary[];
  clinicExpenses: DailyClinicExpenseLine[];
  totals: DoctorDailySummary["stats"] & {
    totalClinicGeneralExpenses: number;
  };
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

function reviewFeeAmountOnOp(op: TodayOperationRow): number {
  const row = op as TodayOperationRow & { review_fee_amount?: number | string | null };
  return num(row.review_fee_amount);
}

function isReviewFeeCollection(
  op: TodayOperationRow,
  clinicReviewFee = 0
): boolean {
  const raw = op as TodayOperationRow & {
    review_fee_amount?: number | string | null;
  };
  if (
    isReviewFeeOnlyPayment(
      {
        paid_amount: op.paid_amount,
        review_fee_amount: raw.review_fee_amount,
        is_review_statement: op.is_review_statement,
      },
      clinicReviewFee
    )
  ) {
    return true;
  }
  const label = opName(op);
  return label.includes("كشفية") || label.includes("كشف +");
}

function sessionLabelFromOp(
  op: TodayOperationRow,
  clinicReviewFee = 0
): string {
  if (num(op.remaining_debt) > 0 && num(op.paid_amount) <= 0) {
    return `${opName(op)} — تسجيل دين`;
  }
  const paid = ledgerPaidToday(op, clinicReviewFee);
  const reviewFee = resolveReviewFeeOnOperation(
    {
      paid_amount: op.paid_amount,
      review_fee_amount: num(
        (op as { review_fee_amount?: unknown }).review_fee_amount
      ),
      is_review_statement: op.is_review_statement,
    },
    clinicReviewFee
  );
  if (
    reviewFee > FINANCIAL_EPSILON &&
    paid > reviewFee + FINANCIAL_EPSILON
  ) {
    const base =
      opName(op).replace(/\s*—\s*كشف\s*\+\s*كشفية/i, "").trim() || "جلسة";
    return `${base} — علاج + كشفية ${formatCurrency(reviewFee)}`;
  }
  if (isReviewFeeCollection(op, clinicReviewFee)) {
    const fee = reviewFeeAmountOnOp(op) || ledgerPaidToday(op, clinicReviewFee);
    const base = opName(op).replace(/\s*—\s*كشف\s*\+\s*كشفية/i, "").trim() || "كشف";
    return fee > 0
      ? `${base} — كشفية ${formatCurrency(fee)}`
      : `${base} — كشف`;
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
  return normalizePatientNameForMatch(name);
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

/** مفتاح زيارة — طبيب + اسم المراجع (يوحّد الطابور والجلسة حتى لو اختلف patient_id) */
function canonicalVisitKey(input: {
  doctorId: string;
  patientId: string | null;
  patientName: string;
  day?: string;
}): string {
  const name = normalizePatientName(input.patientName || "مراجع");
  const base = `${input.doctorId}:name:${name}`;
  return input.day ? `${base}:${input.day}` : base;
}

function lookupVisitPaidToday(
  visitPaidByKey: Map<string, number>,
  input: {
    doctorId: string;
    patientId: string | null;
    patientName: string;
    day?: string;
  }
): number {
  const vk = canonicalVisitKey(input);
  const direct = visitPaidByKey.get(vk) ?? 0;
  if (direct > FINANCIAL_EPSILON) return direct;
  if (input.patientId) {
    const legacy = visitPaidByKey.get(
      `${input.doctorId}:${input.patientId}${input.day ? `:${input.day}` : ""}`
    );
    if (legacy && legacy > FINANCIAL_EPSILON) return legacy;
  }
  return 0;
}

function isReviewFeeSettledVisit(
  op: TodayOperationRow,
  remaining: number,
  requiredToday: number,
  clinicReviewFee = 0
): boolean {
  if (requiredToday > FINANCIAL_EPSILON) return false;
  if (!isReviewFeeCollection(op, clinicReviewFee)) return false;
  if (ledgerPaidToday(op, clinicReviewFee) <= FINANCIAL_EPSILON) return false;
  return remaining <= FINANCIAL_EPSILON;
}

function debtForCollectionStatus(opts: {
  remaining: number;
  patientDebtTotal: number;
  reviewFeeSettled: boolean;
  visitPaidToday: number;
  requiredToday: number;
}): number {
  if (
    opts.reviewFeeSettled &&
    opts.visitPaidToday > FINANCIAL_EPSILON &&
    opts.requiredToday <= FINANCIAL_EPSILON
  ) {
    return opts.remaining;
  }
  return Math.max(opts.remaining, opts.patientDebtTotal);
}

function isClinicalVisualOnlyOp(op: TodayOperationRow): boolean {
  const label = String(op.operation_name_ar ?? op.operation_type ?? "").trim();
  return label === CLINICAL_SESSION_LABEL;
}

type PatientVisitContext = {
  doctorsByPatientId: Map<string, Set<string>>;
  namesByPatientId: Map<string, string>;
  doctorsByPatientName: Map<string, Set<string>>;
};

function buildPatientVisitContext(
  operations: TodayOperationRow[],
  queueRes: QueueRow[]
): PatientVisitContext {
  const doctorsByPatientId = new Map<string, Set<string>>();
  const namesByPatientId = new Map<string, string>();
  const doctorsByPatientName = new Map<string, Set<string>>();

  const addId = (patientId: string, name: string, doctorId: string) => {
    namesByPatientId.set(patientId, name);
    const set = doctorsByPatientId.get(patientId) ?? new Set();
    set.add(doctorId);
    doctorsByPatientId.set(patientId, set);
  };

  const addName = (name: string, doctorId: string) => {
    const norm = normalizePatientName(name);
    const set = doctorsByPatientName.get(norm) ?? new Set();
    set.add(doctorId);
    doctorsByPatientName.set(norm, set);
  };

  for (const op of operations) {
    if (!op.doctor_id) continue;
    const name = op.patient?.full_name_ar?.trim() || "مراجع";
    if (op.patient_id) addId(op.patient_id, name, op.doctor_id);
    else addName(name, op.doctor_id);
  }
  for (const q of queueRes) {
    if (!q.doctor_id) continue;
    const name = q.patient_name?.trim() || "مراجع";
    if (q.patient_id) addId(q.patient_id, name, q.doctor_id);
    else addName(name, q.doctor_id);
  }

  return { doctorsByPatientId, namesByPatientId, doctorsByPatientName };
}

function patientSawDoctorToday(
  ctx: PatientVisitContext,
  patientId: string | null,
  patientName: string,
  doctorId: string
): boolean {
  if (patientId) {
    const set = ctx.doctorsByPatientId.get(patientId);
    if (set?.has(doctorId)) return true;
  }
  return (
    ctx.doctorsByPatientName.get(normalizePatientName(patientName))?.has(
      doctorId
    ) ?? false
  );
}

const PAYMENT_OPS_SELECT =
  "*, patient:patients!patient_id(full_name_ar, phone, phone_number), doctor:doctors!doctor_id(full_name_ar), patient_treatment_cases(doctor_share_total, clinic_share_total, final_price), invoices(paid_amount, total_amount, remaining_amount)";

async function fetchPatientPaymentOpsForPeriod(
  supabase: SupabaseClient,
  clinicId: string,
  from: string,
  to: string,
  patientIds: string[],
  existing: TodayOperationRow[]
): Promise<TodayOperationRow[]> {
  if (!patientIds.length) return existing;
  const byId = new Map(existing.map((o) => [o.id, o]));

  const { data } = await supabase
    .from("patient_operations")
    .select(PAYMENT_OPS_SELECT)
    .eq("clinic_id", clinicId)
    .gte("operation_date", from)
    .lte("operation_date", to)
    .in("patient_id", patientIds);

  for (const row of data ?? []) {
    const op = row as TodayOperationRow;
    const prev = byId.get(op.id);
    byId.set(op.id, prev ? { ...prev, ...op } : op);
  }
  return [...byId.values()];
}

function sumVisitPaidToday(
  operations: TodayOperationRow[],
  groupByDay: boolean,
  ctx: PatientVisitContext,
  filterDoctorId?: string,
  clinicReviewFee = 0
): Map<string, number> {
  const totals = new Map<string, number>();
  for (const op of operations) {
    const paid = ledgerPaidToday(op, clinicReviewFee);
    if (paid <= FINANCIAL_EPSILON) continue;

    const patientId = op.patient_id ?? null;
    const patientName =
      op.patient?.full_name_ar?.trim() ||
      (patientId ? ctx.namesByPatientId.get(patientId) : null) ||
      "مراجع";
    const day = groupByDay ? op.operation_date ?? undefined : undefined;

    if (filterDoctorId) {
      if (
        !patientSawDoctorToday(ctx, patientId, patientName, filterDoctorId)
      ) {
        continue;
      }
      const key = canonicalVisitKey({
        doctorId: filterDoctorId,
        patientId,
        patientName,
        day,
      });
      totals.set(key, (totals.get(key) ?? 0) + paid);
      continue;
    }

    const doctorId = op.doctor_id;
    if (!doctorId) continue;
    const key = canonicalVisitKey({ doctorId, patientId, patientName, day });
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
  reviewFeeSettled?: boolean;
}): CollectionPaymentStatus {
  const { paidToday, visitPaidToday, remaining, caseDebtTotal, requiredToday, queueStatus, hasOperation } =
    input;
  const paid = Math.max(paidToday, visitPaidToday);
  const debt = Math.max(remaining, caseDebtTotal);

  if (input.reviewFeeSettled && paid > FINANCIAL_EPSILON) {
    return "paid_full";
  }

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
  doctor: Doctor | null;
};

/** حصة الطبيب لزيارة — نسبته الحالية فقط (بدون 50/50 مخزّن) */
function earnedVisitShareLive(
  ops: TodayOperationRow[],
  meta: DoctorPaymentMeta,
  clinicReviewFee = 0
): number {
  if (meta.salary) return 0;

  let total = 0;
  for (const op of ops) {
    const raw = op as TodayOperationRow & {
      review_fee_amount?: unknown;
      is_review_statement?: boolean | null;
    };
    const treatmentPaid = treatmentPaidForDoctorShare(
      {
        paid_amount: num(op.paid_amount),
        review_fee_amount: num(raw.review_fee_amount),
        is_review_statement: raw.is_review_statement,
      },
      clinicReviewFee
    );
    if (treatmentPaid <= FINANCIAL_EPSILON) continue;

    if (meta.doctor) {
      total += computeLiveDoctorShare(
        treatmentPaid,
        meta.doctor,
        num(op.materials_cost)
      );
    } else if (meta.pct > 0) {
      total += roundMoney(treatmentPaid * meta.pct);
    }
  }
  return roundMoney(total);
}

function computeVisitDoctorShares(
  operations: TodayOperationRow[],
  visitPaidByKey: Map<string, number>,
  metaByDoctor: Map<string, DoctorPaymentMeta>,
  groupByDay: boolean,
  clinicReviewFee = 0
): { byDoctor: Map<string, number>; byVisit: Map<string, number> } {
  const groups = new Map<
    string,
    { doctorId: string; vk: string; ops: TodayOperationRow[] }
  >();

  for (const op of operations) {
    const doctorId = op.doctor_id;
    if (!doctorId) continue;
    if (ledgerPaidToday(op, clinicReviewFee) <= FINANCIAL_EPSILON) continue;

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
    const meta = metaByDoctor.get(doctorId);
    if (!meta) continue;
    const earned = earnedVisitShareLive(ops, meta, clinicReviewFee);
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
    totalWithdrawnInPeriod: 0,
    totalPendingWithdrawalInPeriod: 0,
    totalToppedUpInPeriod: 0,
    totalDoctorExpenseDeduction: 0,
    totalDoctorExpenseClinicShare: 0,
    availableBalance: null,
    withdrawableLimit: null,
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

function applyDoctorExpensesToStats(
  stats: DoctorDailySummary["stats"],
  lines: DailyDoctorExpenseLine[]
): void {
  const sums = sumDoctorExpenseDeductions(lines);
  stats.totalDoctorExpenseDeduction = sums.doctor;
  stats.totalDoctorExpenseClinicShare = sums.clinic;
}

function applyBalanceTopupsToStats(
  stats: DoctorDailySummary["stats"],
  toppedUpInPeriod: number
): void {
  stats.totalToppedUpInPeriod = toppedUpInPeriod;
}

function applyWithdrawalsToStats(
  stats: DoctorDailySummary["stats"],
  withdrawnInPeriod: number,
  pendingInPeriod: number
): void {
  stats.totalWithdrawnInPeriod = withdrawnInPeriod;
  stats.totalPendingWithdrawalInPeriod = pendingInPeriod;
}

/** صف واحد لكل مراجع + طبيب في اليوم — بدل تكرار الاسم لكل سجل */
function mergeRowsByVisit(
  rows: DailyCollectionRow[],
  groupByDay: boolean,
  visitPaidByKey: Map<string, number>
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
      const row = group[0]!;
      const vkPaid = lookupVisitPaidToday(visitPaidByKey, {
        doctorId: row.doctorId,
        patientId: row.patientId,
        patientName: row.patientName,
        day: groupByDay ? row.visitDate ?? undefined : undefined,
      });
      const visitPaidToday = Math.max(
        row.visitPaidToday,
        vkPaid,
        row.paidToday
      );
      if (visitPaidToday <= row.visitPaidToday + FINANCIAL_EPSILON) {
        merged.push(row);
        continue;
      }
      const reviewFeeSettled =
        row.sessionLabel.includes("كشفية") &&
        visitPaidToday > FINANCIAL_EPSILON &&
        row.requiredToday <= FINANCIAL_EPSILON &&
        row.remaining <= FINANCIAL_EPSILON;
      const queueStatus =
        visitPaidToday > FINANCIAL_EPSILON
          ? null
          : row.paymentStatus === "at_accountant"
            ? "ready_for_billing"
            : row.paymentStatus === "in_visit"
              ? "in_progress"
              : null;
      merged.push({
        ...row,
        visitPaidToday,
        paymentStatus: resolvePaymentStatus({
          paidToday: Math.max(row.paidToday, visitPaidToday),
          visitPaidToday,
          remaining: row.remaining,
          caseDebtTotal: row.caseDebtTotal,
          requiredToday: row.requiredToday,
          queueStatus,
          hasOperation: row.operationIds.length > 0,
          reviewFeeSettled,
        }),
      });
      continue;
    }

    const sorted = [...group].sort((a, b) => b.paidToday - a.paidToday);
    const primary = sorted[0]!;
    const vkPaid = lookupVisitPaidToday(visitPaidByKey, {
      doctorId: primary.doctorId,
      patientId: primary.patientId,
      patientName: primary.patientName,
      day: groupByDay ? primary.visitDate ?? undefined : undefined,
    });
    const visitPaidToday = Math.max(
      vkPaid,
      ...group.map((r) => r.visitPaidToday),
      ...group.map((r) => r.paidToday)
    );
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
    const queueStatus =
      visitPaidToday > FINANCIAL_EPSILON
        ? null
        : group.some((r) => r.paymentStatus === "at_accountant")
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

    const reviewFeeSettled =
      group.some((r) => r.sessionLabel.includes("كشفية")) &&
      visitPaidToday > FINANCIAL_EPSILON &&
      requiredToday <= FINANCIAL_EPSILON &&
      remaining <= FINANCIAL_EPSILON;

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
        reviewFeeSettled,
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
  target.totalWithdrawnInPeriod += source.totalWithdrawnInPeriod;
  target.totalPendingWithdrawalInPeriod += source.totalPendingWithdrawalInPeriod;
  target.totalToppedUpInPeriod += source.totalToppedUpInPeriod;
  target.totalDoctorExpenseDeduction += source.totalDoctorExpenseDeduction;
  target.totalDoctorExpenseClinicShare += source.totalDoctorExpenseClinicShare;
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

async function loadClinicDefaultReviewFee(
  supabase: SupabaseClient,
  clinicId: string
): Promise<number> {
  const { data } = await supabase
    .from("clinics")
    .select("review_fee_enabled, review_fee_amount")
    .eq("id", clinicId)
    .maybeSingle();
  if (!data?.review_fee_enabled) return 0;
  return num(data.review_fee_amount);
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

  const clinicReviewFee = await loadClinicDefaultReviewFee(supabase, clinicId);

  const [ledger, queueRes, doctorsRes] = await Promise.all([
    fetchLedgerOperationsForDate(supabase, clinicId, {
      dateFrom: effectiveFrom,
      dateTo: effectiveTo,
      doctorId: input.doctorId,
    }),
    fetchQueueForPeriod(supabase, clinicId, effectiveFrom, effectiveTo, input.doctorId),
    supabase
      .from("doctors")
      .select(DOCTOR_FINANCE_WITH_NAME_SELECT)
      .eq("clinic_id", clinicId)
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

  const patientIdsInScope = [
    ...new Set(
      [
        ...operations.map((o) => o.patient_id),
        ...queueRes.map((q) => q.patient_id),
      ].filter((id): id is string => !!id && id.length > 0)
    ),
  ];

  const visitContext = buildPatientVisitContext(operations, queueRes);
  const opsForVisitPaid = await fetchPatientPaymentOpsForPeriod(
    supabase,
    clinicId,
    effectiveFrom,
    effectiveTo,
    patientIdsInScope,
    operations
  );
  const visitPaidByKey = sumVisitPaidToday(
    opsForVisitPaid,
    groupByDay,
    visitContext,
    input.doctorId,
    clinicReviewFee
  );
  const patientDebtMap = sumPatientDebtFromCases(caseInfoById);

  const metaByDoctor = new Map<string, DoctorPaymentMeta>();
  for (const doc of doctorsRes.data ?? []) {
    const doctor = doc as Doctor;
      metaByDoctor.set(String(doc.id), {
      pct: doctorPaymentPct(doctor),
      salary: isSalaryDoctor({ payment_type: doc.payment_type }),
      doctor,
    });
  }
  if (input.doctorId && !metaByDoctor.has(input.doctorId)) {
    const { data: doc } = await supabase
      .from("doctors")
      .select(DOCTOR_FINANCE_WITH_NAME_SELECT)
      .eq("id", input.doctorId)
      .maybeSingle();
    if (doc) {
      const doctor = doc as Doctor;
      metaByDoctor.set(input.doctorId, {
        pct: doctorPaymentPct(doctor),
        salary: isSalaryDoctor({ payment_type: doc.payment_type }),
        doctor,
      });
    }
  }

  const missingDoctorIds = [
    ...new Set(
      opsForVisitPaid
        .map((op) => op.doctor_id)
        .filter((id): id is string => !!id && !metaByDoctor.has(id))
    ),
  ];
  if (missingDoctorIds.length) {
    const { data: extraDocs } = await supabase
      .from("doctors")
      .select(DOCTOR_FINANCE_WITH_NAME_SELECT)
      .in("id", missingDoctorIds);
    for (const doc of extraDocs ?? []) {
      const doctor = doc as Doctor;
      metaByDoctor.set(String(doc.id), {
      pct: doctorPaymentPct(doctor),
      salary: isSalaryDoctor({ payment_type: doc.payment_type }),
      doctor,
    });
    }
  }
  const { byVisit: visitDoctorShareByKey } = computeVisitDoctorShares(
    opsForVisitPaid.filter(
      (op) => !input.doctorId || op.doctor_id === input.doctorId
    ),
    visitPaidByKey,
    metaByDoctor,
    groupByDay,
    clinicReviewFee
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

  const withdrawalLines = await fetchDailyDoctorWithdrawalLines(
    supabase,
    clinicId,
    {
      dateFrom: effectiveFrom,
      dateTo: effectiveTo,
      doctorId: input.doctorId,
    }
  );
  const withdrawalsByDoctor = sumConfirmedWithdrawalsByDoctor(withdrawalLines);
  const pendingWithdrawalsByDoctor = sumPendingWithdrawalsByDoctor(withdrawalLines);
  const withdrawalLinesByDoctor = new Map<string, DoctorWithdrawalLine[]>();
  for (const line of withdrawalLines) {
    const list = withdrawalLinesByDoctor.get(line.doctorId) ?? [];
    list.push(line);
    withdrawalLinesByDoctor.set(line.doctorId, list);
  }

  const balanceTopUpLines = await fetchDailyDoctorBalanceTopUpLines(
    supabase,
    clinicId,
    {
      dateFrom: effectiveFrom,
      dateTo: effectiveTo,
      doctorId: input.doctorId,
    }
  );
  const topupsByDoctor = sumBalanceTopUpsByDoctor(balanceTopUpLines);
  const topupLinesByDoctor = new Map<string, DoctorBalanceTopUpLine[]>();
  for (const line of balanceTopUpLines) {
    const list = topupLinesByDoctor.get(line.doctorId) ?? [];
    list.push(line);
    topupLinesByDoctor.set(line.doctorId, list);
  }

  const [doctorExpenseLines, clinicExpenseLines] = await Promise.all([
    fetchDailyDoctorExpenseLines(supabase, clinicId, {
      dateFrom: effectiveFrom,
      dateTo: effectiveTo,
      doctorId: input.doctorId,
    }),
    input.doctorId
      ? Promise.resolve([] as DailyClinicExpenseLine[])
      : fetchDailyClinicExpenseLines(supabase, clinicId, {
          dateFrom: effectiveFrom,
          dateTo: effectiveTo,
        }),
  ]);

  const doctorExpenseLinesByDoctor = new Map<string, DailyDoctorExpenseLine[]>();
  for (const line of doctorExpenseLines) {
    const list = doctorExpenseLinesByDoctor.get(line.doctorId) ?? [];
    list.push(line);
    doctorExpenseLinesByDoctor.set(line.doctorId, list);
  }

  function applyDoctorFinancialExtras(
    stats: DoctorDailySummary["stats"],
    doctorId: string
  ): void {
    applyWithdrawalsToStats(
      stats,
      withdrawalsByDoctor.get(doctorId) ?? 0,
      pendingWithdrawalsByDoctor.get(doctorId) ?? 0
    );
    applyBalanceTopupsToStats(stats, topupsByDoctor.get(doctorId) ?? 0);
    applyDoctorExpensesToStats(
      stats,
      doctorExpenseLinesByDoctor.get(doctorId) ?? []
    );
  }

  function doctorFinancialExtras(doctorId: string) {
    return {
      withdrawals: withdrawalLinesByDoctor.get(doctorId) ?? [],
      balanceTopups: topupLinesByDoctor.get(doctorId) ?? [],
      doctorExpenses: doctorExpenseLinesByDoctor.get(doctorId) ?? [],
    };
  }

  const sessionRows: DailyCollectionRow[] = [];

  for (const op of operations) {
    const doctorId = op.doctor_id;
    if (!doctorId) continue;

    const patientId = op.patient_id ?? null;
    const patientName = op.patient?.full_name_ar?.trim() || "مراجع";
    const paidToday = ledgerPaidToday(op, clinicReviewFee);

    if (
      isClinicalVisualOnlyOp(op) &&
      paidToday <= FINANCIAL_EPSILON
    ) {
      continue;
    }

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
    const visitPaidToday = lookupVisitPaidToday(visitPaidByKey, {
      doctorId,
      patientId,
      patientName,
      day: groupByDay ? opDate : undefined,
    });

    const patientDebt = patientId ? patientDebtMap.get(patientId) : undefined;
    const patientDebtTotal = patientDebt?.total ?? 0;
    const reviewFeeSettled = isReviewFeeSettledVisit(
      op,
      remaining,
      requiredToday,
      clinicReviewFee
    );
    const caseDebtTotal = debtForCollectionStatus({
      remaining,
      patientDebtTotal,
      reviewFeeSettled,
      visitPaidToday: Math.max(visitPaidToday, paidToday),
      requiredToday,
    });
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
      reviewFeeSettled,
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
      sessionLabel: sessionLabelFromOp(op, clinicReviewFee),
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
    const visitPaidToday = lookupVisitPaidToday(visitPaidByKey, {
      doctorId: entry.doctor_id,
      patientId: entry.patient_id,
      patientName,
      day: groupByDay ? entryDate : undefined,
    });

    const patientDebtForQueue = entry.patient_id
      ? patientDebtMap.get(entry.patient_id)
      : undefined;
    const queuePatientDebt = patientDebtForQueue?.total ?? 0;

    // زيارة دُفعت (كشفية أو دفعة) لكن الطابور لم يُغلق — لا نكرر صف «تحصيل»
    if (
      visitPaidToday > FINANCIAL_EPSILON &&
      queuePatientDebt <= FINANCIAL_EPSILON &&
      (entry.status === "ready_for_billing" ||
        entry.status === "ready_for_payment")
    ) {
      continue;
    }

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

  const mergedSessionRows = mergeRowsByVisit(
    sessionRows,
    groupByDay,
    visitPaidByKey
  );

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
      applyDoctorFinancialExtras(stats, doctorId);
      return {
        doctorId,
        doctorName: doctorNameById.get(doctorId) ?? "طبيب",
        rows: sorted,
        assistantPayroll: assistantLinesByDoctor.get(doctorId) ?? [],
        ...doctorFinancialExtras(doctorId),
        stats,
      };
    })
    .sort((a, b) => a.doctorName.localeCompare(b.doctorName, "ar"));

  for (const doctorId of assistantByDoctor.keys()) {
    if (doctors.some((d) => d.doctorId === doctorId)) continue;
    const assistantTotals = assistantByDoctor.get(doctorId)!;
    const stats = emptyStats();
    applyAssistantPayrollToStats(stats, assistantTotals);
    applyDoctorFinancialExtras(stats, doctorId);
    doctors.push({
      doctorId,
      doctorName: doctorNameById.get(doctorId) ?? "طبيب",
      rows: [],
      assistantPayroll: assistantLinesByDoctor.get(doctorId) ?? [],
      ...doctorFinancialExtras(doctorId),
      stats,
    });
  }

  const withdrawalDoctorIds = new Set(withdrawalLines.map((line) => line.doctorId));

  for (const doctorId of withdrawalDoctorIds) {
    if (doctors.some((d) => d.doctorId === doctorId)) continue;
    const stats = emptyStats();
    applyDoctorFinancialExtras(stats, doctorId);
    doctors.push({
      doctorId,
      doctorName:
        doctorNameById.get(doctorId) ??
        withdrawalLinesByDoctor.get(doctorId)?.[0]?.doctorName ??
        topupLinesByDoctor.get(doctorId)?.[0]?.doctorName ??
        "طبيب",
      rows: [],
      assistantPayroll: [],
      ...doctorFinancialExtras(doctorId),
      stats,
    });
  }

  for (const doctorId of topupsByDoctor.keys()) {
    if (doctors.some((d) => d.doctorId === doctorId)) continue;
    const stats = emptyStats();
    applyDoctorFinancialExtras(stats, doctorId);
    doctors.push({
      doctorId,
      doctorName:
        doctorNameById.get(doctorId) ??
        topupLinesByDoctor.get(doctorId)?.[0]?.doctorName ??
        "طبيب",
      rows: [],
      assistantPayroll: [],
      ...doctorFinancialExtras(doctorId),
      stats,
    });
  }

  for (const doctorId of doctorExpenseLinesByDoctor.keys()) {
    if (doctors.some((d) => d.doctorId === doctorId)) continue;
    const stats = emptyStats();
    applyDoctorFinancialExtras(stats, doctorId);
    doctors.push({
      doctorId,
      doctorName:
        doctorNameById.get(doctorId) ??
        doctorExpenseLinesByDoctor.get(doctorId)?.[0]?.doctorName ??
        "طبيب",
      rows: [],
      assistantPayroll: [],
      ...doctorFinancialExtras(doctorId),
      stats,
    });
  }

  const walletDoctorIds = doctors.map((d) => d.doctorId);
  const walletStatsMap = await fetchDoctorWalletStatsBatch(
    supabase,
    walletDoctorIds
  );
  for (const group of doctors) {
    const wallet = walletStatsMap.get(group.doctorId);
    group.stats.availableBalance = wallet?.availableBalance ?? null;
    group.stats.withdrawableLimit = wallet?.withdrawableLimit ?? null;
  }

  doctors.sort((a, b) => a.doctorName.localeCompare(b.doctorName, "ar"));

  const totals = {
    ...emptyStats(),
    totalClinicGeneralExpenses: sumClinicGeneralExpenses(clinicExpenseLines),
  };
  for (const group of doctors) {
    mergeStats(totals, group.stats);
  }

  return {
    date: effectiveFrom,
    dateFrom: effectiveFrom,
    dateTo: effectiveTo,
    doctors,
    clinicExpenses: clinicExpenseLines,
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

export type PeriodDoctorEarningRow = {
  doctorId: string;
  doctorName: string;
  collected: number;
  doctorShare: number;
  clinicShare: number;
};

type CaseShareRow = {
  id?: string | null;
  final_price?: number | string | null;
  primary_doctor_id?: string | null;
};

function isReviewFeeOnlyOperation(
  op: TodayOperationRow,
  clinicReviewFee = 0
): boolean {
  const raw = op as TodayOperationRow & {
    is_review_statement?: boolean | null;
    review_fee_amount?: number | string | null;
  };
  return isReviewFeeOnlyPayment(
    {
      paid_amount: op.paid_amount,
      review_fee_amount: raw.review_fee_amount,
      is_review_statement: raw.is_review_statement,
    },
    clinicReviewFee
  );
}

function doctorShareByLivePercentage(
  paid: number,
  doctor: Doctor | null | undefined,
  op: TodayOperationRow,
  clinicReviewFee = 0
): number {
  if (paid <= FINANCIAL_EPSILON || !doctor || isSalaryDoctor(doctor)) {
    return 0;
  }

  const raw = op as TodayOperationRow & {
    review_fee_amount?: number | string | null;
    is_review_statement?: boolean | null;
  };
  const treatmentPaid = treatmentPaidForDoctorShare(
    {
      paid_amount: paid,
      review_fee_amount: raw.review_fee_amount,
      is_review_statement: raw.is_review_statement,
    },
    clinicReviewFee
  );
  if (treatmentPaid <= FINANCIAL_EPSILON) return 0;

  return computeLiveDoctorShare(
    treatmentPaid,
    doctor,
    num(op.materials_cost)
  );
}

/** حصص الأطباء/العيادة للوحة التنفيذية — حسب طبيب الحالة ونسبة الطبيب الحالية */
export async function fetchPeriodCollectionFinancialTotals(
  supabase: SupabaseClient,
  clinicId: string,
  from: string,
  to: string
): Promise<{
  collected: number;
  doctorShareTotal: number;
  clinicShareTotal: number;
  byDoctor: PeriodDoctorEarningRow[];
}> {
  const { operations } = await fetchLedgerOperationsForDate(supabase, clinicId, {
    dateFrom: from,
    dateTo: to,
  });

  const clinicReviewFee = await loadClinicDefaultReviewFee(supabase, clinicId);

  const caseIds = [
    ...new Set(
      operations
        .map((op) => op.treatment_case_id?.trim())
        .filter((id): id is string => !!id)
    ),
  ];

  const casesRes = caseIds.length
    ? await supabase
        .from("patient_treatment_cases")
        .select("id, final_price, primary_doctor_id")
        .in("id", caseIds)
    : { data: [] as CaseShareRow[] };

  const caseById = new Map(
    ((casesRes.data ?? []) as CaseShareRow[]).map((row) => [
      String(row.id),
      row,
    ])
  );

  const doctorIds = [
    ...new Set(
      operations
        .map((op) => {
          const caseId = op.treatment_case_id?.trim();
          const caseDoctorId = caseId
            ? caseById.get(caseId)?.primary_doctor_id
            : null;
          return caseDoctorId || op.doctor_id;
        })
        .filter((id): id is string => !!id)
    ),
  ];

  const doctorsRes = doctorIds.length
    ? await supabase
        .from("doctors")
        .select(DOCTOR_FINANCE_WITH_NAME_SELECT)
        .in("id", doctorIds)
    : { data: [] as Doctor[] };

  const doctorById = new Map<string, Doctor>();
  for (const row of (doctorsRes.data ?? []) as Doctor[]) {
    doctorById.set(String(row.id), row);
  }

  const byDoctorMap = new Map<string, PeriodDoctorEarningRow>();
  let collected = 0;
  let doctorShareTotal = 0;

  for (const op of operations) {
    const paid = ledgerPaidToday(op, clinicReviewFee);
    if (paid <= FINANCIAL_EPSILON) continue;

    collected += paid;

    if (isReviewFeeOnlyOperation(op, clinicReviewFee)) {
      continue;
    }

    const caseId = op.treatment_case_id?.trim();
    const caseRow = caseId ? caseById.get(caseId) : undefined;
    const effectiveDoctorId = caseRow?.primary_doctor_id || op.doctor_id;
    if (!effectiveDoctorId) continue;

    const doctor = doctorById.get(effectiveDoctorId);
    const doctorShare = doctorShareByLivePercentage(
      paid,
      doctor,
      op,
      clinicReviewFee
    );
    doctorShareTotal += doctorShare;

    const current = byDoctorMap.get(effectiveDoctorId) ?? {
      doctorId: effectiveDoctorId,
      doctorName: String(doctor?.full_name_ar ?? "طبيب"),
      collected: 0,
      doctorShare: 0,
      clinicShare: 0,
    };
    current.collected = roundMoney(current.collected + paid);
    current.doctorShare = roundMoney(current.doctorShare + doctorShare);
    current.clinicShare = roundMoney(
      Math.max(0, current.collected - current.doctorShare)
    );
    byDoctorMap.set(effectiveDoctorId, current);
  }

  collected = roundMoney(collected);
  doctorShareTotal = roundMoney(doctorShareTotal);
  const clinicShareTotal = roundMoney(Math.max(0, collected - doctorShareTotal));
  const byDoctor = [...byDoctorMap.values()].sort(
    (a, b) => b.collected - a.collected || b.doctorShare - a.doctorShare
  );

  return {
    collected,
    doctorShareTotal,
    clinicShareTotal,
    byDoctor,
  };
}
