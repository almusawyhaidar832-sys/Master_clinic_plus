import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildPlanFromCaseRow,
  computedCaseRemaining,
  FINANCIAL_EPSILON,
} from "@/lib/services/patient-financial-plan";
import { resolveSessionPaidAmount } from "@/lib/services/patient-operations-profile";
import {
  normalizePatientNameForMatch,
} from "@/lib/services/resolve-patient-id";
import { CLINICAL_SESSION_LABEL } from "@/lib/clinical/constants";
import { opDebt, operationLabelForCase, type PatientOperation } from "@/types";
import { localPeriodUtcBounds, todayISO } from "@/lib/utils";

function num(v: unknown): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

export type TodayCaseInfo = {
  id: string;
  patientId: string;
  name: string;
  finalPrice: number;
  totalPaid: number;
  remaining: number;
  status: string;
};

export type TodayOperationRow = PatientOperation & {
  patient?: {
    full_name_ar: string;
    phone?: string | null;
    phone_number?: string | null;
  };
  doctor?: { full_name_ar: string };
  invoices?: { paid_amount: number; total_amount: number; remaining_amount: number }[] | null;
};

/** صف مدمج — زيارة واحدة (كشف + علاج + دفعة) بدل تكرار الاسم */
export type ConsolidatedTodayOperationRow = TodayOperationRow & {
  visitPaidToday: number;
  clinicalOperationId: string | null;
  visitOperationIds: string[];
};

/** مفتاح زيارة — طبيب + ملف المراجع أو الاسم (يدعم عائلة برقم هاتف مشترك) */
function canonicalVisitKey(input: {
  doctorId: string;
  patientId: string | null;
  patientName: string;
}): string {
  if (input.patientId) {
    return `${input.doctorId}:${input.patientId}`;
  }
  return `${input.doctorId}:name:${normalizePatientNameForMatch(input.patientName)}`;
}

function isClinicalCheckupOperation(op: TodayOperationRow): boolean {
  const label = String(op.operation_name_ar ?? op.operation_type ?? "");
  return label === CLINICAL_SESSION_LABEL;
}

function shouldSkipStandaloneLedgerRow(op: TodayOperationRow): boolean {
  if (op.session_kind !== "discount") return false;
  return (
    ledgerPaidToday(op) <= FINANCIAL_EPSILON &&
    num(op.total_amount) <= FINANCIAL_EPSILON
  );
}

/** أولوية العرض — العلاج/الحالة قبل الكشف البصري أو سجل الدفعة المنفصل */
function ledgerOperationDisplayPriority(op: TodayOperationRow): number {
  const paid = ledgerPaidToday(op);
  const total = num(op.total_amount);

  if (op.session_kind === "plan" && total > FINANCIAL_EPSILON) return 0;
  if (total > FINANCIAL_EPSILON) return 1;
  if (op.session_kind === "payment" && paid > FINANCIAL_EPSILON) return 2;
  if (isClinicalCheckupOperation(op)) return 4;
  if (op.session_kind === "payment") return 3;
  if (op.session_kind === "discount") return 5;
  return 3;
}

/**
 * صف واحد لكل مراجع + طبيب في اليوم — يمنع تكرار الاسم
 * (جلسة كشف + علاج + دفعة = صف واحد بمجموع المدفوع).
 */
export function consolidateLedgerOperationsByVisit(
  operations: TodayOperationRow[]
): ConsolidatedTodayOperationRow[] {
  const groups = new Map<string, TodayOperationRow[]>();

  for (const op of operations) {
    if (shouldSkipStandaloneLedgerRow(op)) continue;
    const doctorId = op.doctor_id;
    if (!doctorId) continue;

    const key = canonicalVisitKey({
      doctorId,
      patientId: op.patient_id ?? null,
      patientName: op.patient?.full_name_ar?.trim() || "مراجع",
    });
    const list = groups.get(key) ?? [];
    list.push(op);
    groups.set(key, list);
  }

  const merged: ConsolidatedTodayOperationRow[] = [];

  for (const group of groups.values()) {
    const visitPaidToday = group.reduce(
      (sum, op) => sum + ledgerPaidToday(op),
      0
    );
    const visitOperationIds = group.map((op) => op.id);
    const clinicalOperationId =
      group.find((op) => isClinicalCheckupOperation(op))?.id ??
      group.find((op) => op.queue_entry_id)?.id ??
      null;

    if (group.length === 1) {
      const op = group[0]!;
      merged.push({
        ...op,
        visitPaidToday,
        clinicalOperationId: clinicalOperationId ?? op.id,
        visitOperationIds,
      });
      continue;
    }

    const sorted = [...group].sort(
      (a, b) =>
        ledgerOperationDisplayPriority(a) -
        ledgerOperationDisplayPriority(b)
    );
    const primary = sorted[0]!;

    merged.push({
      ...primary,
      visitPaidToday,
      clinicalOperationId,
      visitOperationIds,
    });
  }

  return merged.sort((a, b) =>
    String(b.created_at ?? "").localeCompare(String(a.created_at ?? ""))
  );
}

export function sessionKindLabel(kind: PatientOperation["session_kind"]): string {
  switch (kind) {
    case "plan":
      return "فتح حالة";
    case "payment":
      return "دفعة";
    case "discount":
      return "خصم";
    case "refund":
      return "استرداد";
    default:
      return "جلسة";
  }
}

/** حلّ معرّف الحالة — من الجلسة أو أحدث حالة نشطة للمراجع */
export function resolveOperationCaseId(
  op: PatientOperation,
  patientPrimaryCaseId: Map<string, string>
): string | null {
  const direct = op.treatment_case_id?.trim();
  if (direct) return direct;
  const patientId = op.patient_id?.trim();
  if (!patientId) return null;
  return patientPrimaryCaseId.get(patientId) ?? null;
}

export function ledgerCaseName(
  op: PatientOperation,
  caseInfoById: Map<string, TodayCaseInfo>,
  patientPrimaryCaseId: Map<string, string>
): string {
  const caseId = resolveOperationCaseId(op, patientPrimaryCaseId);
  if (caseId && caseInfoById.has(caseId)) {
    return caseInfoById.get(caseId)!.name;
  }
  return operationLabelForCase(op);
}

function reviewFeeOnOp(op: PatientOperation): number {
  return num((op as { review_fee_amount?: unknown }).review_fee_amount);
}

/** المدفوع في الجلسة — يشمل الكشفية حتى لو paid_amount صفر في قاعدة البيانات */
export function ledgerPaidToday(op: TodayOperationRow | PatientOperation): number {
  const fromPaid = Math.max(0, resolveSessionPaidAmount(op));
  const row = op as PatientOperation & {
    review_fee_amount?: number;
    is_review_statement?: boolean;
    clinic_share_amount?: number;
  };
  const reviewFee = reviewFeeOnOp(row);

  if (fromPaid > FINANCIAL_EPSILON) {
    if (
      reviewFee > FINANCIAL_EPSILON &&
      row.is_review_statement &&
      fromPaid > reviewFee + FINANCIAL_EPSILON &&
      fromPaid / reviewFee <= 10.5
    ) {
      return fromPaid + reviewFee;
    }
    return fromPaid;
  }
  if (reviewFee > FINANCIAL_EPSILON) {
    if (row.is_review_statement || reviewFee > 0) return reviewFee;
  }

  const label = String(row.operation_name_ar ?? row.operation_type ?? "");
  if (
    reviewFee > FINANCIAL_EPSILON ||
    label.includes("كشفية") ||
    label.includes("كشف +")
  ) {
    return Math.max(reviewFee, num(row.clinic_share_amount));
  }

  return fromPaid;
}

/** المدفوع في الزيارة — مجموع كل السجلات (كشف + علاج + دفعة) */
export function ledgerVisitPaidToday(
  op: ConsolidatedTodayOperationRow | TodayOperationRow
): number {
  if ("visitPaidToday" in op && typeof op.visitPaidToday === "number") {
    return Math.max(0, op.visitPaidToday);
  }
  return ledgerPaidToday(op);
}

/** المتبقي المعروض في جدول جلسات اليوم — ذمة الحالة إن وُجدت */
export function ledgerDisplayRemaining(
  op: PatientOperation,
  caseRemainingById: Map<string, number>,
  patientPrimaryCaseId: Map<string, string> = new Map()
): number {
  const caseId = resolveOperationCaseId(op, patientPrimaryCaseId);
  if (caseId && caseRemainingById.has(caseId)) {
    return Math.max(0, caseRemainingById.get(caseId)!);
  }
  if (op.session_kind === "payment" && op.total_amount <= 0) {
    return 0;
  }
  return opDebt(op);
}

function buildCaseInfoFromRow(row: Record<string, unknown>): TodayCaseInfo {
  const casePrice = num(row.case_price);
  const discount = num(row.discount_total);
  const finalPrice =
    num(row.final_price) || Math.max(0, casePrice - discount);
  const plan = buildPlanFromCaseRow({
    case_price: casePrice,
    discount_total: discount,
    final_price: finalPrice,
    doctor_share_total: num(row.doctor_share_total),
    clinic_share_total: num(row.clinic_share_total),
    total_paid: num(row.total_paid),
  });
  const remaining = computedCaseRemaining(plan);
  return {
    id: String(row.id),
    patientId: String(row.patient_id ?? ""),
    name: String(row.treatment_name_ar ?? "علاج").trim() || "علاج",
    finalPrice,
    totalPaid: num(row.total_paid),
    remaining,
    status: String(row.treatment_status ?? row.status ?? "active"),
  };
}

export type LedgerOperationsFilters = {
  date?: string;
  dateFrom?: string;
  dateTo?: string;
  doctorId?: string;
  limit?: number;
};

export async function fetchLedgerOperationsForDate(
  supabase: SupabaseClient,
  clinicId: string,
  filters: LedgerOperationsFilters = {}
): Promise<{
  operations: TodayOperationRow[];
  caseRemainingById: Map<string, number>;
  caseInfoById: Map<string, TodayCaseInfo>;
  patientPrimaryCaseId: Map<string, string>;
}> {
  const dateFrom = filters.dateFrom ?? filters.date ?? todayISO();
  const dateTo = filters.dateTo ?? filters.date ?? dateFrom;
  const singleDay = dateFrom === dateTo;
  const allDoctors = !filters.doctorId;
  const limit =
    filters.limit ??
    (allDoctors ? undefined : singleDay ? 500 : 2000);
  const { startIso, endIso } = localPeriodUtcBounds(dateFrom, dateTo);

  const selectCols =
    "*, patient:patients!patient_id(full_name_ar, phone, phone_number), doctor:doctors!doctor_id(full_name_ar), invoices(paid_amount, total_amount, remaining_amount)";

  let byOpDateQuery = supabase
    .from("patient_operations")
    .select(selectCols)
    .eq("clinic_id", clinicId)
    .gte("operation_date", dateFrom)
    .lte("operation_date", dateTo)
    .order("created_at", { ascending: false });

  let byCreatedQuery = supabase
    .from("patient_operations")
    .select(selectCols)
    .eq("clinic_id", clinicId)
    .gte("created_at", startIso)
    .lte("created_at", endIso)
    .order("created_at", { ascending: false });

  if (limit != null) {
    byOpDateQuery = byOpDateQuery.limit(limit);
    byCreatedQuery = byCreatedQuery.limit(limit);
  }

  if (filters.doctorId) {
    byOpDateQuery = byOpDateQuery.eq("doctor_id", filters.doctorId);
    byCreatedQuery = byCreatedQuery.eq("doctor_id", filters.doctorId);
  }

  const [byOpDateRes, byCreatedRes] = await Promise.all([
    byOpDateQuery,
    byCreatedQuery,
  ]);

  const mergedById = new Map<string, TodayOperationRow>();
  for (const row of [...(byOpDateRes.data ?? []), ...(byCreatedRes.data ?? [])]) {
    mergedById.set((row as TodayOperationRow).id, row as TodayOperationRow);
  }

  const operations = [...mergedById.values()].sort((a, b) =>
    String(b.created_at ?? "").localeCompare(String(a.created_at ?? ""))
  );

  const patientIds = [
    ...new Set(
      operations
        .map((op) => op.patient_id)
        .filter((id): id is string => !!id && id.length > 0)
    ),
  ];

  const patientPrimaryCaseId = new Map<string, string>();
  const allCaseIds = new Set(
    operations
      .map((op) => op.treatment_case_id)
      .filter((id): id is string => !!id && id.length > 0)
  );

  if (patientIds.length > 0) {
    const { data: patientCases } = await supabase
      .from("patient_treatment_cases")
      .select(
        "id, patient_id, treatment_name_ar, case_price, discount_total, final_price, total_paid, doctor_share_total, clinic_share_total, treatment_status, status"
      )
      .eq("clinic_id", clinicId)
      .in("patient_id", patientIds)
      .order("created_at", { ascending: false });

    for (const row of patientCases ?? []) {
      const r = row as Record<string, unknown>;
      const patientId = String(r.patient_id ?? "");
      const caseId = String(r.id ?? "");
      const status = String(r.treatment_status ?? r.status ?? "active");
      if (!patientId || !caseId) continue;

      allCaseIds.add(caseId);

      if (status === "completed") continue;
      if (!patientPrimaryCaseId.has(patientId)) {
        patientPrimaryCaseId.set(patientId, caseId);
      }
    }
  }

  const caseRemainingById = new Map<string, number>();
  const caseInfoById = new Map<string, TodayCaseInfo>();

  if (allCaseIds.size > 0) {
    const { data: cases } = await supabase
      .from("patient_treatment_cases")
      .select(
        "id, patient_id, treatment_name_ar, case_price, discount_total, final_price, total_paid, doctor_share_total, clinic_share_total, treatment_status, status"
      )
      .in("id", [...allCaseIds]);

    for (const row of cases ?? []) {
      const info = buildCaseInfoFromRow(row as Record<string, unknown>);
      caseInfoById.set(info.id, info);
      caseRemainingById.set(info.id, info.remaining);
    }
  }

  return { operations, caseRemainingById, caseInfoById, patientPrimaryCaseId };
}

export async function fetchTodayLedgerOperations(
  supabase: SupabaseClient,
  clinicId: string
): Promise<{
  operations: ConsolidatedTodayOperationRow[];
  caseRemainingById: Map<string, number>;
  caseInfoById: Map<string, TodayCaseInfo>;
  patientPrimaryCaseId: Map<string, string>;
}> {
  const ledger = await fetchLedgerOperationsForDate(supabase, clinicId, {
    date: todayISO(),
  });
  return {
    ...ledger,
    operations: consolidateLedgerOperationsByVisit(ledger.operations),
  };
}
