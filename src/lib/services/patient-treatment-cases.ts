import type { SupabaseClient } from "@supabase/supabase-js";
import { formatCurrency } from "@/lib/utils";
import { operationLabelForCase, opDebt, opName } from "@/types";
import type { PatientOperation } from "@/types";
import {
  buildPlanFromCaseRow,
  computedCaseRemaining,
  FINANCIAL_EPSILON,
  isTreatmentCaseOpenForPicker,
  treatmentStatusFromAmounts,
  type PatientFinancialPlan,
} from "@/lib/services/patient-financial-plan";

export { computedCaseRemaining } from "@/lib/services/patient-financial-plan";
import { caseBelongsToDoctor } from "@/lib/services/doctor-patients";

export interface PatientTreatmentCase extends PatientFinancialPlan {
  id: string;
  treatment_name_ar: string;
  /** الطبيب المعالج الحالي للحالة — يتغيّر بتحويل الطبيب */
  primary_doctor_id?: string | null;
  primary_doctor_name?: string | null;
}

export type TreatmentCaseWithPatient = PatientTreatmentCase & {
  patient_id?: string;
  patient_name?: string;
};

function num(v: unknown): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

export function treatmentNameKey(name: string): string {
  return name.trim().toLowerCase() || "علاج";
}

/** عنوان الحالة — يُميّز حالتين بنفس الاسم بالسعر الكلي */
export function treatmentCaseDisplayLabel(
  c: Pick<PatientTreatmentCase, "treatment_name_ar" | "case_price">,
  allCases: Pick<PatientTreatmentCase, "treatment_name_ar">[]
): string {
  const name = c.treatment_name_ar.trim() || "علاج";
  const sameNameCount = allCases.filter(
    (x) => treatmentNameKey(x.treatment_name_ar) === treatmentNameKey(name)
  ).length;
  if (sameNameCount > 1 && c.case_price > 0) {
    return `${name} (${formatCurrency(c.case_price)})`;
  }
  return name;
}

/** معرّف حالة محفوظ في patient_treatment_cases (ليس inferred-*) */
export function isPersistedTreatmentCaseId(
  id: string | null | undefined
): boolean {
  const v = id?.trim();
  return !!v && !v.startsWith("inferred-");
}

/** تحويل inferred-* إلى UUID الحقيقي من نفس الاسم إن وُجد */
export function resolvePersistedCaseId(
  cases: PatientTreatmentCase[],
  caseId: string | null | undefined
): string | null {
  if (!caseId?.trim()) return null;
  if (isPersistedTreatmentCaseId(caseId)) return caseId.trim();
  const inferred = cases.find((c) => c.id === caseId);
  if (!inferred) return null;
  const nameKey = slugKey(inferred.treatment_name_ar);
  const matches = cases.filter(
    (c) =>
      isPersistedTreatmentCaseId(c.id) &&
      slugKey(c.treatment_name_ar) === nameKey
  );
  if (matches.length === 0) return null;
  const open = matches.filter((c) => isTreatmentCaseOpenForPicker(c));
  if (open.length > 0) return open[0].id;
  return matches[0].id;
}

/** على السيرفر: تحويل inferred-* إلى UUID من patient_treatment_cases */
export async function resolvePersistedCaseIdFromDb(
  supabase: SupabaseClient,
  patientId: string,
  caseId: string | null | undefined,
  treatmentNameAr?: string | null
): Promise<string | null> {
  const { data: rows } = await supabase
    .from("patient_treatment_cases")
    .select("id, treatment_name_ar")
    .eq("patient_id", patientId);

  const stubs: PatientTreatmentCase[] = (rows ?? []).map((row) => ({
    id: String(row.id),
    treatment_name_ar: String(row.treatment_name_ar ?? "علاج"),
    case_price: 0,
    discount_total: 0,
    final_price: 0,
    agreed_total: 0,
    original_agreed_total: 0,
    doctor_share_total: 0,
    clinic_share_total: 0,
    total_paid: 0,
    remaining_balance: 0,
    financial_locked: false,
    treatment_status: "active",
  }));

  if (caseId?.trim()) {
    const byId = resolvePersistedCaseId(stubs, caseId);
    if (byId) return byId;
  }

  const name = treatmentNameAr?.trim();
  if (name) {
    const key = treatmentNameKey(
      name.replace(/\s*—\s*خصم.*$/i, "").trim() || name
    );
    const match = stubs.find(
      (c) =>
        isPersistedTreatmentCaseId(c.id) &&
        treatmentNameKey(c.treatment_name_ar) === key
    );
    if (match) return match.id;
  }

  return null;
}

function slugKey(name: string): string {
  return treatmentNameKey(name);
}

function isValidCase(c: PatientTreatmentCase): boolean {
  return (
    c.case_price > 0 ||
    c.final_price > 0 ||
    c.total_paid > 0 ||
    c.remaining_balance > 0
  );
}

/** هل الجلسة تتبع هذه الحالة؟ — حالة محفوظة: treatment_case_id فقط (لا دمج بالاسم) */
export function opsBelongToCase(
  dbCase: Pick<PatientTreatmentCase, "id" | "treatment_name_ar">,
  op: PatientOperation
): boolean {
  const linked = op.treatment_case_id?.trim();
  if (isPersistedTreatmentCaseId(dbCase.id)) {
    return !!linked && linked === dbCase.id;
  }
  const nameMatch =
    slugKey(operationLabelForCase(op)) === slugKey(dbCase.treatment_name_ar);
  if (linked) return linked === dbCase.id;
  return nameMatch;
}

/** كل جلسات الحالة — مربوطة بـ case_id + مطابقة بالاسم */
export function collectOperationsForTreatmentCase(
  allOps: PatientOperation[],
  caseHint: Pick<PatientTreatmentCase, "id" | "treatment_name_ar">
): PatientOperation[] {
  const caseId = caseHint.id?.trim();
  const linked = caseId
    ? allOps.filter((o) => o.treatment_case_id?.trim() === caseId)
    : [];
  return mergeOperationsForCase(allOps, caseHint, linked);
}

type CaseHints = {
  case_price?: number;
  discount_total?: number;
  final_price?: number;
  /** من patient_treatment_cases — مصدر موثوق عند غياب جلسات مربوطة */
  total_paid?: number;
  doctor_share_total?: number;
  clinic_share_total?: number;
};

function sortOpsByDate(ops: PatientOperation[]): PatientOperation[] {
  return [...ops].sort((a, b) => {
    const ta = a.created_at ?? a.operation_date ?? "";
    const tb = b.created_at ?? b.operation_date ?? "";
    return ta.localeCompare(tb);
  });
}

/** جمع كل جلسات الحالة — مرتبطة بـ case_id أو مطابقة بالاسم */
export function mergeOperationsForCase(
  allOps: PatientOperation[],
  hint: Pick<PatientTreatmentCase, "id" | "treatment_name_ar">,
  linkedOps?: PatientOperation[]
): PatientOperation[] {
  const merged = new Map<string, PatientOperation>();
  for (const op of linkedOps ?? []) {
    merged.set(op.id, op);
  }
  for (const op of allOps) {
    if (opsBelongToCase(hint, op)) merged.set(op.id, op);
  }
  return sortOpsByDate([...merged.values()]);
}

/** معرّف الحالة من الجلسة — treatment_case_id أو مطابقة الاسم في DB */
export async function resolveCaseIdForOp(
  supabase: SupabaseClient,
  op: PatientOperation
): Promise<{
  caseId: string | null;
  caseHint: Pick<PatientTreatmentCase, "id" | "treatment_name_ar"> | null;
}> {
  const linked = op.treatment_case_id?.trim();
  if (linked && isPersistedTreatmentCaseId(linked)) {
    const { data } = await supabase
      .from("patient_treatment_cases")
      .select("id, treatment_name_ar")
      .eq("id", linked)
      .maybeSingle();
    if (data) {
      return {
        caseId: linked,
        caseHint: {
          id: String(data.id),
          treatment_name_ar: String(data.treatment_name_ar ?? "علاج"),
        },
      };
    }
  }

  const label = operationLabelForCase(op).trim() || "علاج";
  const key = slugKey(label);
  const { data: rows } = await supabase
    .from("patient_treatment_cases")
    .select(
      "id, treatment_name_ar, final_price, case_price, discount_total, total_paid, remaining_balance, treatment_status"
    )
    .eq("patient_id", op.patient_id);

  const matches = (rows ?? []).filter(
    (r) => slugKey(String(r.treatment_name_ar ?? "")) === key
  );
  const open = matches.find((r) => {
    const row = r as Record<string, unknown>;
    if (String(row.treatment_status ?? "") === "completed") return false;
    const finalP =
      num(row.final_price) ||
      Math.max(0, num(row.case_price) - num(row.discount_total));
    const paid = num(row.total_paid);
    return finalP > 0 && paid < finalP - FINANCIAL_EPSILON;
  });
  const match = open ?? null;
  if (match) {
    return {
      caseId: String(match.id),
      caseHint: {
        id: String(match.id),
        treatment_name_ar: String(match.treatment_name_ar ?? label),
      },
    };
  }

  return { caseId: null, caseHint: null };
}

/**
 * المدفوع من جلسات الحالة — مجموع paid_amount (لا ذمة المريض على مستوى patient_operations).
 */
export function computeCasePaidFromOps(
  ops: PatientOperation[],
  finalPrice: number
): { totalPaid: number; casePriceFromOps: number; lastRemaining: number } {
  const sorted = sortOpsByDate(ops);
  let casePriceFromOps = 0;
  let sumPaid = 0;

  for (const op of sorted) {
    const total = num(op.total_amount);
    if (total > 0) casePriceFromOps = Math.max(casePriceFromOps, total);
    sumPaid += num(op.paid_amount);
  }

  const cappedPaid =
    finalPrice > FINANCIAL_EPSILON
      ? Math.min(sumPaid, finalPrice)
      : sumPaid;
  const remaining =
    finalPrice > FINANCIAL_EPSILON
      ? Math.max(0, finalPrice - cappedPaid)
      : 0;

  return {
    totalPaid: cappedPaid,
    casePriceFromOps,
    lastRemaining: remaining,
  };
}

/**
 * حساب الحالة من جلساتها.
 * السعر من patient_treatment_cases (إن وُجد) — المدفوع من الجلسات مع تصحيح التكرار.
 */
function buildCaseFromOps(
  ops: PatientOperation[],
  treatmentName: string,
  caseId: string,
  hints?: CaseHints
): PatientTreatmentCase {
  const discount = hints?.discount_total ?? 0;
  let doctorShare = num(hints?.doctor_share_total);
  let clinicShare = num(hints?.clinic_share_total);

  const sorted = sortOpsByDate(ops);
  for (const op of sorted) {
    if (num(op.doctor_share_amount) > 0) {
      doctorShare = num(op.doctor_share_amount);
    }
    if (num(op.clinic_share_amount) > 0) {
      clinicShare = num(op.clinic_share_amount);
    }
  }

  const prelimFinal =
    hints?.final_price && hints.final_price > 0
      ? hints.final_price
      : Math.max(
          0,
          (hints?.case_price && hints.case_price > 0
            ? hints.case_price
            : 0) - discount
        );

  const paidMeta = computeCasePaidFromOps(ops, prelimFinal);
  let totalPaid = paidMeta.totalPaid;
  let lastRemaining = paidMeta.lastRemaining;

  let casePrice =
    hints?.case_price && hints.case_price > 0
      ? hints.case_price
      : paidMeta.casePriceFromOps;

  if (casePrice <= 0 && totalPaid > 0) {
    casePrice = totalPaid + lastRemaining;
  }
  if (casePrice <= 0 && lastRemaining > 0) {
    casePrice = lastRemaining;
  }

  const finalPrice =
    hints?.final_price && hints.final_price > 0
      ? hints.final_price
      : Math.max(0, casePrice - discount);

  if (ops.length === 0 && hints) {
    if (hints.case_price && hints.case_price > 0) casePrice = hints.case_price;
    if (hints.final_price && hints.final_price > 0) {
      // finalPrice already set from hints above
    }
    const dbPaid = hints.total_paid ?? 0;
    totalPaid =
      finalPrice > FINANCIAL_EPSILON
        ? Math.min(dbPaid, finalPrice)
        : dbPaid;
    lastRemaining =
      finalPrice > FINANCIAL_EPSILON
        ? Math.max(0, finalPrice - totalPaid)
        : 0;
  } else if (finalPrice > FINANCIAL_EPSILON) {
    const corrected = computeCasePaidFromOps(ops, finalPrice);
    totalPaid = corrected.totalPaid;
    lastRemaining = corrected.lastRemaining;
  }

  const plan = buildPlanFromCaseRow({
    case_price: casePrice,
    discount_total: discount,
    final_price: finalPrice,
    doctor_share_total: doctorShare,
    clinic_share_total: clinicShare,
    total_paid: totalPaid,
  });

  return finalizeTreatmentCase({
    ...plan,
    id: caseId,
    treatment_name_ar: treatmentName.trim() || "علاج",
  });
}

function inferCasesFromOperationsByName(
  ops: PatientOperation[],
  patientId: string
): PatientTreatmentCase[] {
  const groups = new Map<string, { name: string; ops: PatientOperation[] }>();

  for (const op of ops) {
    const name = opName(op).trim() || "علاج";
    const key = slugKey(name);
    if (!groups.has(key)) groups.set(key, { name, ops: [] });
    groups.get(key)!.ops.push(op);
  }

  const cases: PatientTreatmentCase[] = [];
  let idx = 0;

  for (const g of groups.values()) {
    if (!g.ops.length) continue;
    const built = buildCaseFromOps(
      g.ops,
      g.name,
      `inferred-${patientId}-${idx++}`
    );
    if (isValidCase(built)) cases.push(built);
  }

  return cases.sort((a, b) => b.remaining_balance - a.remaining_balance);
}

function relationDoctorName(
  rel: { full_name_ar?: string } | { full_name_ar?: string }[] | null | undefined
): string | null {
  if (!rel) return null;
  const row = Array.isArray(rel) ? rel[0] : rel;
  return row?.full_name_ar?.trim() || null;
}

function mapDbRow(row: Record<string, unknown>): PatientTreatmentCase {
  const casePrice = num(row.case_price);
  const discount = num(row.discount_total);
  const finalPrice = num(row.final_price) || Math.max(0, casePrice - discount);
  const plan = buildPlanFromCaseRow({
    case_price: casePrice,
    discount_total: discount,
    final_price: finalPrice,
    doctor_share_total: num(row.doctor_share_total),
    clinic_share_total: num(row.clinic_share_total),
    total_paid: num(row.total_paid),
  });
  const primaryDoctorId = row.primary_doctor_id
    ? String(row.primary_doctor_id)
    : null;
  const primaryDoctorName =
    relationDoctorName(
      row.doctor as { full_name_ar?: string } | { full_name_ar?: string }[] | null
    ) ?? null;
  return finalizeTreatmentCase({
    ...plan,
    id: String(row.id),
    treatment_name_ar: String(row.treatment_name_ar ?? "علاج").trim(),
    primary_doctor_id: primaryDoctorId,
    primary_doctor_name: primaryDoctorName,
  });
}

function sortCases(cases: PatientTreatmentCase[]): PatientTreatmentCase[] {
  return cases.sort((a, b) => {
    if (a.treatment_status !== b.treatment_status) {
      return a.treatment_status === "active" ? -1 : 1;
    }
    return b.remaining_balance - a.remaining_balance;
  });
}

/** جلب الحالات عبر API السيرفر — يقرأ كل صفوف patient_treatment_cases */
export async function fetchPatientTreatmentCasesViaApi(
  patientId: string
): Promise<PatientTreatmentCase[] | null> {
  if (typeof window === "undefined") return null;
  try {
    const { authPortalHeaders } = await import("@/lib/auth/api-portal");
    const res = await fetch(
      `/api/treatment-cases?patientId=${encodeURIComponent(patientId)}`,
      {
        credentials: "include",
        headers: authPortalHeaders("accountant"),
      }
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { cases?: PatientTreatmentCase[] };
    return Array.isArray(data.cases) ? data.cases : [];
  } catch {
    return null;
  }
}

export async function fetchPatientTreatmentCases(
  supabase: SupabaseClient,
  patientId: string,
  _clinicId?: string
): Promise<PatientTreatmentCase[]> {
  const viaApi = await fetchPatientTreatmentCasesViaApi(patientId);
  if (viaApi !== null) return viaApi;
  return fetchPatientTreatmentCasesDirect(supabase, patientId);
}

export async function fetchPatientTreatmentCasesDirect(
  supabase: SupabaseClient,
  patientId: string,
  opts?: { skipReconcile?: boolean }
): Promise<PatientTreatmentCase[]> {
  let rows: Record<string, unknown>[] | null = null;
  let error: { message: string } | null = null;

  const joined = await supabase
    .from("patient_treatment_cases")
    .select(
      "*, doctor:doctors!primary_doctor_id(id, full_name_ar)"
    )
    .eq("patient_id", patientId)
    .order("created_at", { ascending: false });

  if (joined.error?.message?.includes("primary_doctor_id")) {
    const fallback = await supabase
      .from("patient_treatment_cases")
      .select("*")
      .eq("patient_id", patientId)
      .order("created_at", { ascending: false });
    rows = (fallback.data ?? []) as Record<string, unknown>[];
    error = fallback.error;
  } else {
    rows = (joined.data ?? []) as Record<string, unknown>[];
    error = joined.error;
  }

  if (error) {
    console.error("[fetchPatientTreatmentCases] cases query", error.message);
  }

  const dbCases = rows?.length
    ? rows.map((row) => mapDbRow(row as Record<string, unknown>))
    : [];

  const { data: ops, error: opsErr } = await supabase
    .from("patient_operations")
    .select("*")
    .eq("patient_id", patientId)
    .order("created_at", { ascending: true });

  if (opsErr) {
    console.error("[fetchPatientTreatmentCases] ops query", opsErr.message);
    return dbCases
      .filter((c) =>
        isPersistedTreatmentCaseId(c.id) ? true : isValidCase(c)
      )
      .map(finalizeTreatmentCase);
  }

  const allOps = (ops ?? []) as PatientOperation[];

  if (dbCases.length === 0) {
    if (!allOps.length) return [];
    return sortCases(inferCasesFromOperationsByName(allOps, patientId));
  }

  const usedOpIds = new Set<string>();
  const result: PatientTreatmentCase[] = [];

  for (const db of dbCases) {
    const caseOps = allOps.filter(
      (o) =>
        !usedOpIds.has(o.id) && o.treatment_case_id?.trim() === db.id
    );
    caseOps.forEach((o) => usedOpIds.add(o.id));

    if (caseOps.length > 0) {
      result.push(
        buildCaseFromOps(caseOps, db.treatment_name_ar, db.id, {
          case_price: db.case_price,
          discount_total: db.discount_total,
          final_price: db.final_price,
          total_paid: db.total_paid,
          doctor_share_total: db.doctor_share_total,
          clinic_share_total: db.clinic_share_total,
        })
      );
    } else {
      result.push(finalizeTreatmentCase(db));
    }
  }

  const orphanOps = allOps.filter((o) => !usedOpIds.has(o.id));
  if (orphanOps.length > 0) {
    const inferred = inferCasesFromOperationsByName(orphanOps, patientId);
    for (const inf of inferred) {
      const nk = slugKey(inf.treatment_name_ar);
      const persistedSameName = result.filter(
        (r) =>
          isPersistedTreatmentCaseId(r.id) && slugKey(r.treatment_name_ar) === nk
      );
      if (persistedSameName.length === 0) {
        result.push(inf);
        continue;
      }
      if (persistedSameName.length > 1) {
        result.push(inf);
        continue;
      }
      const single = persistedSameName[0]!;
      const infPrice = inf.case_price || inf.final_price;
      const singlePrice = single.case_price || single.final_price;
      if (
        infPrice > FINANCIAL_EPSILON &&
        singlePrice > FINANCIAL_EPSILON &&
        Math.abs(infPrice - singlePrice) > FINANCIAL_EPSILON
      ) {
        result.push(inf);
      }
    }
  }

  const list = result
    .filter((c) =>
      isPersistedTreatmentCaseId(c.id) ? true : isValidCase(c)
    )
    .map(finalizeTreatmentCase);
  if (!opts?.skipReconcile) {
    void reconcileCasesToDatabase(supabase, list);
  }
  return sortCases(list);
}

/** حالات عليها ذمة — للطبيب (متابعة العلاج) */
export async function fetchOpenTreatmentCasesForDoctor(
  supabase: SupabaseClient,
  doctorId: string
): Promise<TreatmentCaseWithPatient[]> {
  const { data: rows, error } = await supabase
    .from("patient_treatment_cases")
    .select(
      "*, patient:patients!patient_id(id, full_name_ar)"
    )
    .or(`primary_doctor_id.eq.${doctorId},primary_doctor_id.is.null`)
    .order("updated_at", { ascending: false });

  if (error || !rows?.length) return [];

  const patientIds = [
    ...new Set(
      rows.map((r) => String((r as { patient_id: string }).patient_id))
    ),
  ];

  const { data: allOps } = await supabase
    .from("patient_operations")
    .select("*")
    .in("patient_id", patientIds)
    .order("created_at", { ascending: true });

  const opsByPatient = new Map<string, PatientOperation[]>();
  for (const op of (allOps ?? []) as PatientOperation[]) {
    const pid = op.patient_id;
    if (!opsByPatient.has(pid)) opsByPatient.set(pid, []);
    opsByPatient.get(pid)!.push(op);
  }

  const open: TreatmentCaseWithPatient[] = [];

  for (const row of rows) {
    const r = row as Record<string, unknown> & {
      patient_id: string;
      patient?: { id: string; full_name_ar: string } | { id: string; full_name_ar: string }[];
    };
    const db = mapDbRow(r);
    const patientOps = opsByPatient.get(r.patient_id) ?? [];
    const caseOps = patientOps.filter(
      (o) => o.treatment_case_id?.trim() === db.id
    );

    if (
      !caseBelongsToDoctor(
        {
          id: db.id,
          primary_doctor_id: (r as { primary_doctor_id?: string | null })
            .primary_doctor_id,
        },
        caseOps,
        doctorId
      )
    ) {
      continue;
    }

    const built =
      caseOps.length > 0
        ? buildCaseFromOps(caseOps, db.treatment_name_ar, db.id, {
            case_price: db.case_price,
            discount_total: db.discount_total,
            final_price: db.final_price,
            total_paid: db.total_paid,
            doctor_share_total: db.doctor_share_total,
            clinic_share_total: db.clinic_share_total,
          })
        : finalizeTreatmentCase(db);

    if (!isTreatmentCaseOpenForPicker(built)) continue;

    const patient = Array.isArray(r.patient) ? r.patient[0] : r.patient;
    open.push({
      ...built,
      patient_id: r.patient_id,
      patient_name: patient?.full_name_ar,
    });
  }

  return open.sort((a, b) => b.remaining_balance - a.remaining_balance);
}

export function inferTreatmentCasesFromOperations(
  ops: PatientOperation[],
  patientId = "local"
): PatientTreatmentCase[] {
  return inferCasesFromOperationsByName(ops, patientId);
}

export function computeOutstandingDebtFromOperations(
  ops: PatientOperation[],
  patientId = "local"
): number {
  return inferTreatmentCasesFromOperations(ops, patientId).reduce(
    (s, c) => s + Math.max(0, c.remaining_balance),
    0
  );
}

/** مجموع ذمة المريض من حالات patient_treatment_cases (أدق من دمج الجلسات بالاسم) */
export function computeOutstandingDebtFromTreatmentCases(
  cases: PatientTreatmentCase[]
): number {
  return cases.reduce((s, c) => s + computedCaseRemaining(c), 0);
}

async function reconcileCasesToDatabase(
  supabase: SupabaseClient,
  cases: PatientTreatmentCase[]
): Promise<void> {
  for (const c of cases) {
    if (c.id.startsWith("inferred-")) continue;

    const finalized = finalizeTreatmentCase(c);
    const dbStatus =
      finalized.remaining_balance <= 0 ? "completed" : "active";

    await supabase
      .from("patient_treatment_cases")
      .update({
        case_price: finalized.case_price,
        discount_total: finalized.discount_total,
        final_price: finalized.final_price,
        total_paid: finalized.total_paid,
        status: dbStatus,
        updated_at: new Date().toISOString(),
      })
      .eq("id", c.id);
  }
}

function finalizeTreatmentCase(c: PatientTreatmentCase): PatientTreatmentCase {
  const remaining = Math.max(0, c.final_price - c.total_paid);
  const treatment_status = treatmentStatusFromAmounts(
    c.final_price,
    c.total_paid
  );
  return {
    ...c,
    remaining_balance: remaining,
    treatment_status,
  };
}

/** يملأ حصص الطبيب/العيادة في DB إن كانت صفراً (حالات قديمة) */
export async function backfillTreatmentCaseSharesIfMissing(
  supabase: SupabaseClient,
  caseId: string,
  shares: { doctorShare: number; clinicShare: number }
): Promise<void> {
  if (!isPersistedTreatmentCaseId(caseId)) return;
  if (shares.doctorShare <= 0 && shares.clinicShare <= 0) return;

  const { data: row } = await supabase
    .from("patient_treatment_cases")
    .select("doctor_share_total, clinic_share_total")
    .eq("id", caseId)
    .maybeSingle();

  if (!row) return;
  if (num(row.doctor_share_total) > 0 || num(row.clinic_share_total) > 0) return;

  await supabase
    .from("patient_treatment_cases")
    .update({
      doctor_share_total: shares.doctorShare,
      clinic_share_total: shares.clinicShare,
      updated_at: new Date().toISOString(),
    })
    .eq("id", caseId);
}

export async function createTreatmentCase(
  supabase: SupabaseClient,
  input: {
    patientId: string;
    clinicId: string;
    treatmentName: string;
    casePrice: number;
    discount: number;
    paid: number;
    doctorShare: number;
    clinicShare: number;
    primaryDoctorId?: string | null;
    /** جلسة بدون سعر كلي — لا تخزّن حصصاً على الحالة (تُحسب لكل دفعة) */
    sessionOnly?: boolean;
  }
): Promise<{ case: PatientTreatmentCase | null; error?: string }> {
  const finalPrice = Math.max(0, input.casePrice - input.discount);
  const status = treatmentStatusFromAmounts(finalPrice, input.paid);

  const row: Record<string, unknown> = {
    patient_id: input.patientId,
    clinic_id: input.clinicId,
    treatment_name_ar: input.treatmentName.trim(),
    case_price: input.casePrice,
    discount_total: input.discount,
    final_price: finalPrice,
    doctor_share_total: input.sessionOnly ? 0 : input.doctorShare,
    clinic_share_total: input.sessionOnly ? 0 : input.clinicShare,
    total_paid: input.sessionOnly ? 0 : input.paid,
    status,
  };

  if (input.primaryDoctorId) {
    row.primary_doctor_id = input.primaryDoctorId;
  }

  const { data, error } = await supabase
    .from("patient_treatment_cases")
    .insert(row)
    .select("*")
    .single();

  if (error) return { case: null, error: error.message };

  return { case: mapDbRow(data as Record<string, unknown>) };
}

/** إنشاء حالة عبر API السيرفر — يتجاوز RLS الذي يمنع INSERT من المتصفح */
export async function createTreatmentCaseViaApi(input: {
  patientId: string;
  treatmentName: string;
  casePrice: number;
  discount: number;
  paid: number;
  doctorShare: number;
  clinicShare: number;
  doctorId: string;
  /** جلسة بدون سعر كلي — casePrice يجب أن يكون 0 */
  sessionOnly?: boolean;
}): Promise<{ case: PatientTreatmentCase | null; error?: string }> {
  try {
    const { authPortalHeaders } = await import("@/lib/auth/api-portal");
    const res = await fetch("/api/treatment-cases", {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        ...authPortalHeaders("accountant"),
      },
      body: JSON.stringify(input),
    });
    const data = (await res.json()) as {
      case?: PatientTreatmentCase;
      error?: string;
    };
    if (!res.ok) {
      return { case: null, error: data.error ?? `HTTP ${res.status}` };
    }
    if (!data.case?.id) {
      return { case: null, error: "لم يُرجع السيرفر معرّف الحالة" };
    }
    return { case: data.case };
  } catch (e) {
    return {
      case: null,
      error: e instanceof Error ? e.message : "تعذر الاتصال بالسيرفر",
    };
  }
}

export async function updateTreatmentCasePayment(
  supabase: SupabaseClient,
  caseId: string,
  paidDelta: number,
  additionalDiscount = 0
): Promise<{ ok: boolean; completed?: boolean; error?: string }> {
  if (caseId.startsWith("inferred-")) {
    return { ok: true, completed: false };
  }

  const { data, error } = await supabase
    .from("patient_treatment_cases")
    .select("*")
    .eq("id", caseId)
    .maybeSingle();

  if (error || !data) {
    return { ok: false, error: error?.message ?? "الحالة غير موجودة" };
  }

  const r = data as Record<string, unknown>;
  const casePrice = num(r.case_price);
  const discount = num(r.discount_total) + additionalDiscount;
  const finalPrice = Math.max(0, casePrice - discount);
  const totalPaid = num(r.total_paid) + paidDelta;
  const status = treatmentStatusFromAmounts(finalPrice, totalPaid);
  const ratio = num(r.final_price) > 0 ? finalPrice / num(r.final_price) : 1;

  const { error: uErr } = await supabase
    .from("patient_treatment_cases")
    .update({
      discount_total: discount,
      final_price: finalPrice,
      total_paid: totalPaid,
      doctor_share_total:
        Math.round(num(r.doctor_share_total) * ratio * 100) / 100,
      clinic_share_total:
        Math.round(num(r.clinic_share_total) * ratio * 100) / 100,
      status,
      updated_at: new Date().toISOString(),
    })
    .eq("id", caseId);

  if (uErr) return { ok: false, error: uErr.message };
  return { ok: true, completed: status === "completed" };
}

/** تطبيق دفعة على حالة واحدة — يُعيد الحساب من جلساتها فقط (لا إجمالي المريض) */
export async function processCasePayment(
  supabase: SupabaseClient,
  input: {
    caseId: string;
    paidDelta: number;
    additionalDiscount?: number;
  }
): Promise<{ ok: boolean; completed: boolean; error?: string }> {
  if (!isPersistedTreatmentCaseId(input.caseId)) {
    return { ok: false, completed: false, error: "معرّف الحالة غير صالح" };
  }

  if ((input.additionalDiscount ?? 0) > 0) {
    const disc = await updateTreatmentCasePayment(
      supabase,
      input.caseId,
      0,
      input.additionalDiscount ?? 0
    );
    if (!disc.ok) {
      return { ok: false, completed: false, error: disc.error };
    }
  }

  const bal = await computeCaseBalanceById(supabase, input.caseId);
  if (!bal) {
    return {
      ok: false,
      completed: false,
      error: "تعذر حساب ذمة الحالة",
    };
  }

  const status = treatmentStatusFromAmounts(bal.finalPrice, bal.totalPaid);
  const { error } = await supabase
    .from("patient_treatment_cases")
    .update({
      total_paid: bal.totalPaid,
      status,
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.caseId);

  if (error) {
    return { ok: false, completed: false, error: error.message };
  }

  const { data: caseRow } = await supabase
    .from("patient_treatment_cases")
    .select("patient_id, treatment_name_ar")
    .eq("id", input.caseId)
    .maybeSingle();

  if (caseRow) {
    await linkUnlinkedCaseOperations(
      supabase,
      input.caseId,
      String(caseRow.patient_id),
      String(caseRow.treatment_name_ar ?? "علاج")
    );
  }

  return {
    ok: true,
    completed: status === "completed",
  };
}

/** ذمة حالة من جلساتها — لا يستخدم إجمالي حساب المريض */
export async function computeCaseBalanceById(
  supabase: SupabaseClient,
  caseId: string
): Promise<{
  finalPrice: number;
  totalPaid: number;
  remainingBalance: number;
  treatmentName: string;
} | null> {
  if (!isPersistedTreatmentCaseId(caseId)) return null;

  const { data: row, error } = await supabase
    .from("patient_treatment_cases")
    .select("*")
    .eq("id", caseId)
    .maybeSingle();

  if (error || !row) {
    if (error) {
      console.error("[computeCaseBalanceById]", caseId, error.message);
    } else {
      console.warn(
        "[computeCaseBalanceById] case not found or not visible",
        caseId
      );
    }
    return null;
  }

  const r = row as Record<string, unknown>;
  const treatmentName = String(r.treatment_name_ar ?? "علاج");
  const casePrice = num(r.case_price);
  const discount = num(r.discount_total);
  const finalPrice =
    num(r.final_price) || Math.max(0, casePrice - discount);

  const patientId = String(r.patient_id ?? "");
  const hint = { id: caseId, treatment_name_ar: treatmentName };

  const [{ data: linkedOps }, { data: allOps }] = await Promise.all([
    supabase
      .from("patient_operations")
      .select("*")
      .eq("treatment_case_id", caseId)
      .order("created_at", { ascending: true }),
    patientId
      ? supabase
          .from("patient_operations")
          .select("*")
          .eq("patient_id", patientId)
          .order("created_at", { ascending: true })
      : Promise.resolve({ data: [] as PatientOperation[] }),
  ]);

  const caseOps = mergeOperationsForCase(
    (allOps ?? []) as PatientOperation[],
    hint,
    (linkedOps ?? []) as PatientOperation[]
  );

  const paidMeta = computeCasePaidFromOps(caseOps, finalPrice);
  const totalPaid = paidMeta.totalPaid;
  const remainingBalance = Math.max(0, finalPrice - totalPaid);

  return { finalPrice, totalPaid, remainingBalance, treatmentName };
}

export async function syncTreatmentCaseAfterSession(
  supabase: SupabaseClient,
  input: {
    patientId: string;
    clinicId: string;
    treatmentName: string;
    plan: PatientFinancialPlan;
    paidDelta: number;
    additionalDiscount?: number;
    /** معرّف الحالة — إلزامي للمتابعة حتى لا تُحدَّث حالة خاطئة */
    caseId?: string | null;
  }
): Promise<{ ok: boolean; completed: boolean; caseId?: string; error?: string }> {
  const name = input.treatmentName.trim() || "علاج";
  const key = slugKey(name);
  const addDisc = input.additionalDiscount ?? 0;
  const discount = input.plan.discount_total + addDisc;
  const finalPrice = Math.max(0, input.plan.case_price - discount);
  const totalPaid = input.plan.total_paid + input.paidDelta;
  const status = treatmentStatusFromAmounts(finalPrice, totalPaid);
  const ratio =
    input.plan.final_price > 0 ? finalPrice / input.plan.final_price : 1;
  const doctorShare =
    Math.round(input.plan.doctor_share_total * ratio * 100) / 100;
  const clinicShare =
    Math.round(input.plan.clinic_share_total * ratio * 100) / 100;

  if (input.caseId && isPersistedTreatmentCaseId(input.caseId)) {
    const upd = await processCasePayment(supabase, {
      caseId: input.caseId,
      paidDelta: input.paidDelta,
      additionalDiscount: addDisc,
    });
    return {
      ok: upd.ok,
      completed: upd.completed,
      caseId: input.caseId,
      error: upd.error,
    };
  }

  const { data: rows } = await supabase
    .from("patient_treatment_cases")
    .select(
      "id, treatment_name_ar, final_price, case_price, discount_total, total_paid, status, created_at"
    )
    .eq("patient_id", input.patientId)
    .order("created_at", { ascending: false });

  const matches = (rows ?? []).filter(
    (r) => slugKey(String(r.treatment_name_ar ?? "")) === key
  );
  const openMatch = matches.find((r) => {
    const row = r as Record<string, unknown>;
    if (String(row.status ?? "") === "completed") return false;
    const finalP =
      num(row.final_price) ||
      Math.max(0, num(row.case_price) - num(row.discount_total));
    const paid = num(row.total_paid);
    return finalP > FINANCIAL_EPSILON && paid < finalP - FINANCIAL_EPSILON;
  });
  const existing = openMatch ?? matches[0];

  if (existing?.id) {
    const upd = await processCasePayment(supabase, {
      caseId: String(existing.id),
      paidDelta: input.paidDelta,
      additionalDiscount: addDisc,
    });
    return {
      ok: upd.ok,
      completed: upd.completed,
      caseId: String(existing.id),
      error: upd.error,
    };
  }

  if (input.plan.case_price <= 0 && totalPaid <= 0) {
    return { ok: true, completed: false };
  }

  const created = await createTreatmentCase(supabase, {
    patientId: input.patientId,
    clinicId: input.clinicId,
    treatmentName: name,
    casePrice: input.plan.case_price,
    discount,
    paid: totalPaid,
    doctorShare,
    clinicShare,
  });

  if (!created.case) {
    return { ok: false, completed: false, error: created.error };
  }

  return {
    ok: true,
    completed: status === "completed",
    caseId: created.case.id,
  };
}

/** مزامنة ذمة الحالة عبر API السيرفر — يتجاوز RLS من المتصفح */
export async function syncTreatmentCaseAfterSessionViaApi(input: {
  patientId: string;
  treatmentName: string;
  plan: PatientFinancialPlan;
  paidDelta: number;
  additionalDiscount?: number;
  caseId?: string | null;
}): Promise<{
  ok: boolean;
  completed: boolean;
  caseId?: string;
  error?: string;
}> {
  try {
    const res = await fetch("/api/treatment-cases/sync-session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    const data = (await res.json()) as {
      ok?: boolean;
      completed?: boolean;
      caseId?: string;
      error?: string;
    };
    if (!res.ok) {
      return {
        ok: false,
        completed: false,
        error: data.error ?? `HTTP ${res.status}`,
      };
    }
    return {
      ok: Boolean(data.ok),
      completed: Boolean(data.completed),
      caseId: data.caseId,
      error: data.error,
    };
  } catch (e) {
    return {
      ok: false,
      completed: false,
      error: e instanceof Error ? e.message : "تعذر الاتصال بالسيرفر",
    };
  }
}

/** تسجيل دين صريح على حالة — بدون سعر كلي (final_price = total_paid + الدين) */
export async function registerTreatmentCaseDebt(
  supabase: SupabaseClient,
  input: {
    caseId: string;
    debtAmount: number;
    /** استبدال الدين السابق بدلاً من إضافته */
    replace?: boolean;
  }
): Promise<{ ok: boolean; error?: string; remainingBalance?: number }> {
  if (!isPersistedTreatmentCaseId(input.caseId)) {
    return { ok: false, error: "معرّف الحالة غير صالح" };
  }
  const debt = Math.max(0, input.debtAmount);
  if (debt <= FINANCIAL_EPSILON) {
    return { ok: false, error: "مبلغ الدين مطلوب" };
  }

  const bal = await computeCaseBalanceById(supabase, input.caseId);
  if (!bal) {
    return { ok: false, error: "تعذر قراءة الحالة" };
  }

  const totalPaid = bal.totalPaid;
  const newFinal = input.replace
    ? totalPaid + debt
    : Math.max(bal.finalPrice, totalPaid + debt);

  const { error } = await supabase
    .from("patient_treatment_cases")
    .update({
      final_price: newFinal,
      case_price: Math.max(newFinal, 0),
      status: "active",
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.caseId);

  if (error) return { ok: false, error: error.message };

  return {
    ok: true,
    remainingBalance: Math.max(0, newFinal - totalPaid),
  };
}

/** إغلاق حالة علاج — بغض النظر عن السعر الكلي */
export async function completeTreatmentCase(
  supabase: SupabaseClient,
  caseId: string
): Promise<{ ok: boolean; error?: string }> {
  if (!isPersistedTreatmentCaseId(caseId)) {
    return { ok: false, error: "معرّف الحالة غير صالح" };
  }

  const { error } = await supabase
    .from("patient_treatment_cases")
    .update({
      status: "completed",
      updated_at: new Date().toISOString(),
    })
    .eq("id", caseId);

  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function registerTreatmentCaseDebtViaApi(input: {
  caseId: string;
  debtAmount: number;
  replace?: boolean;
}): Promise<{ ok: boolean; error?: string; remainingBalance?: number }> {
  try {
    const { authPortalHeaders } = await import("@/lib/auth/api-portal");
    const res = await fetch("/api/treatment-cases/billing-action", {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        ...authPortalHeaders("accountant"),
      },
      body: JSON.stringify({
        action: "debt",
        caseId: input.caseId,
        debtAmount: input.debtAmount,
        replace: input.replace,
      }),
    });
    const data = (await res.json()) as {
      ok?: boolean;
      error?: string;
      remainingBalance?: number;
    };
    if (!res.ok) {
      return { ok: false, error: data.error ?? `HTTP ${res.status}` };
    }
    return {
      ok: Boolean(data.ok),
      error: data.error,
      remainingBalance: data.remainingBalance,
    };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "تعذر الاتصال بالسيرفر",
    };
  }
}

export async function completeTreatmentCaseViaApi(
  caseId: string
): Promise<{ ok: boolean; error?: string }> {
  try {
    const { authPortalHeaders } = await import("@/lib/auth/api-portal");
    const res = await fetch("/api/treatment-cases/billing-action", {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        ...authPortalHeaders("accountant"),
      },
      body: JSON.stringify({ action: "complete", caseId }),
    });
    const data = (await res.json()) as { ok?: boolean; error?: string };
    if (!res.ok) {
      return { ok: false, error: data.error ?? `HTTP ${res.status}` };
    }
    return { ok: Boolean(data.ok), error: data.error };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "تعذر الاتصال بالسيرفر",
    };
  }
}

/** ربط جلسة محفوظة بمعرّف الحالة (بعد الإدراج إن حُذف العمود مؤقتاً) */
export async function linkOperationToTreatmentCase(
  supabase: SupabaseClient,
  operationId: string,
  caseId: string
): Promise<void> {
  if (!isPersistedTreatmentCaseId(caseId) || !operationId?.trim()) return;
  const { error } = await supabase
    .from("patient_operations")
    .update({ treatment_case_id: caseId })
    .eq("id", operationId);
  if (error && !error.message.includes("treatment_case_id")) {
    console.warn("[linkOperationToTreatmentCase]", error.message);
  }
}

/** ربط كل جلسات الحالة غير المرتبطة بـ case_id */
export async function linkUnlinkedCaseOperations(
  supabase: SupabaseClient,
  caseId: string,
  patientId: string,
  treatmentName: string
): Promise<void> {
  if (!isPersistedTreatmentCaseId(caseId)) return;
  const { data: allOps } = await supabase
    .from("patient_operations")
    .select("*")
    .eq("patient_id", patientId)
    .order("created_at", { ascending: true });

  for (const op of (allOps ?? []) as PatientOperation[]) {
    const linked = op.treatment_case_id?.trim();
    if (linked) continue;
    const nameMatch =
      slugKey(operationLabelForCase(op)) === slugKey(treatmentName);
    if (!nameMatch) continue;
    await linkOperationToTreatmentCase(supabase, op.id, caseId);
  }
}

export function caseToFinancialPlan(c: PatientTreatmentCase): PatientFinancialPlan {
  const { id: _id, treatment_name_ar: _n, ...plan } = c;
  return plan;
}
