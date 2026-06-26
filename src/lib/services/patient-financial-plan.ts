import type { SupabaseClient } from "@supabase/supabase-js";
import {
  calculateDoctorShareForDoctor,
  splitTreatmentAndReviewFee,
  type DoctorShareInput,
} from "@/lib/finance";
import { isSalaryDoctor } from "@/lib/services/doctor-payment";
import type { Doctor, DoctorPercentage, MaterialsCostShare } from "@/types";

export type SessionKind = "plan" | "payment";
export type TreatmentStatus = "active" | "completed";

/** Financial plan stored once per patient (patients + patient_treatment_plans) */
export interface PatientFinancialPlan {
  /** Original case price (first session) */
  case_price: number;
  /** Cumulative discount applied once at open */
  discount_total: number;
  /** case_price - discount_total */
  final_price: number;
  /** @deprecated alias — use final_price */
  agreed_total: number;
  original_agreed_total: number;
  doctor_share_total: number;
  clinic_share_total: number;
  total_paid: number;
  remaining_balance: number;
  financial_locked: boolean;
  treatment_status: TreatmentStatus;
}

export function hasTreatmentPlan(plan: PatientFinancialPlan): boolean {
  return (
    plan.financial_locked ||
    plan.case_price > 0 ||
    plan.final_price > 0 ||
    plan.original_agreed_total > 0 ||
    plan.total_paid > 0 ||
    plan.remaining_balance > 0
  );
}

/** استنتاج الخطة من الجلسات السابقة عند غياب patient_treatment_plans */
async function inferPlanFromOperations(
  supabase: SupabaseClient,
  patientId: string,
  patientRow?: Record<string, unknown> | null
): Promise<PatientFinancialPlan | null> {
  const { data: ops } = await supabase
    .from("patient_operations")
    .select("total_amount, paid_amount, remaining_debt, session_kind")
    .eq("patient_id", patientId)
    .order("created_at", { ascending: true });

  if (!ops?.length) return null;

  let casePrice = 0;
  for (const row of ops) {
    const r = row as Record<string, unknown>;
    const t = num(r.total_amount);
    if (t > 0) casePrice = Math.max(casePrice, t);
  }

  if (patientRow) {
    const fromPatient =
      num(patientRow.original_agreed_total) ||
      num(patientRow.previous_total) ||
      0;
    if (fromPatient > 0) casePrice = Math.max(casePrice, fromPatient);
  }

  const paidFromOps = ops.reduce(
    (s, row) => s + num((row as Record<string, unknown>).paid_amount),
    0
  );
  const totalPaid = patientRow
    ? Math.max(num(patientRow.total_paid), paidFromOps)
    : paidFromOps;

  const discount = patientRow ? num(patientRow.discount_total) : 0;

  const last = ops[ops.length - 1] as Record<string, unknown>;
  let remaining = num(last.remaining_debt);
  if (remaining <= 0) {
    remaining = Math.max(0, num(last.total_amount) - num(last.paid_amount));
  }

  const finalPrice =
    patientRow && num(patientRow.agreed_total) > 0
      ? num(patientRow.agreed_total)
      : casePrice > 0
        ? Math.max(0, casePrice - discount)
        : totalPaid + remaining;

  if (casePrice <= 0 && finalPrice > 0) {
    casePrice = finalPrice + discount;
  }

  if (finalPrice <= 0 && totalPaid <= 0 && remaining <= 0) {
    return null;
  }

  if (remaining <= 0 && finalPrice > 0) {
    remaining = Math.max(0, finalPrice - totalPaid);
  }

  return buildPlan({
    case_price: casePrice,
    discount_total: discount,
    final_price: finalPrice,
    doctor_share_total: patientRow ? num(patientRow.doctor_share_total) : 0,
    clinic_share_total: patientRow ? num(patientRow.clinic_share_total) : 0,
    total_paid: totalPaid,
    financial_locked: true,
    treatment_status:
      finalPrice > 0 && totalPaid >= finalPrice ? "completed" : "active",
  });
}

export async function fetchPatientFinancialPlan(
  supabase: SupabaseClient,
  patientId: string
): Promise<PatientFinancialPlan> {
  const { data: tp } = await supabase
    .from("patient_treatment_plans")
    .select("*")
    .eq("patient_id", patientId)
    .maybeSingle();

  if (tp) {
    const row = tp as Record<string, unknown>;
    const casePrice = num(row.case_price);
    const discount = num(row.discount_total);
    const finalPrice = num(row.final_price) || Math.max(0, casePrice - discount);
    const paid = num(row.total_paid);
    const status =
      row.status === "completed" ? "completed" : "active";
    const fromTable = buildPlan({
      case_price: casePrice,
      discount_total: discount,
      final_price: finalPrice,
      doctor_share_total: num(row.doctor_share_total),
      clinic_share_total: num(row.clinic_share_total),
      total_paid: paid,
      financial_locked: true,
      treatment_status:
        status === "completed" || (finalPrice > 0 && paid >= finalPrice)
          ? "completed"
          : "active",
    });
    if (hasTreatmentPlan(fromTable)) return fromTable;
  }

  const { data, error } = await supabase
    .from("patients")
    .select("*")
    .eq("id", patientId)
    .maybeSingle();

  const row = (data ?? null) as Record<string, unknown> | null;

  if (row) {
    const casePrice =
      num(row.original_agreed_total) ||
      num(row.previous_total) ||
      num(row.agreed_total);
    const discount = num(row.discount_total);
    const finalPrice =
      num(row.agreed_total) || Math.max(0, casePrice - discount);
    const paid = num(row.total_paid);
    const locked =
      Boolean(row.financial_locked) || casePrice > 0 || finalPrice > 0;
    const status =
      row.treatment_status === "completed" ? "completed" : "active";

    const fromPatient = buildPlan({
      case_price: casePrice,
      discount_total: discount,
      final_price: finalPrice,
      doctor_share_total: num(row.doctor_share_total),
      clinic_share_total: num(row.clinic_share_total),
      total_paid: paid,
      financial_locked: locked,
      treatment_status:
        status === "completed" || (finalPrice > 0 && paid >= finalPrice)
          ? "completed"
          : "active",
    });

    if (hasTreatmentPlan(fromPatient)) return fromPatient;
  }

  const inferred = await inferPlanFromOperations(supabase, patientId, row);
  if (inferred) return inferred;

  return emptyPlan();
}

function inferPlanFromOperationRows(
  ops: Record<string, unknown>[],
  patientRow?: Record<string, unknown> | null
): PatientFinancialPlan | null {
  if (!ops.length) return null;

  let casePrice = 0;
  for (const row of ops) {
    const t = num(row.total_amount);
    if (t > 0) casePrice = Math.max(casePrice, t);
  }

  if (patientRow) {
    const fromPatient =
      num(patientRow.original_agreed_total) ||
      num(patientRow.previous_total) ||
      0;
    if (fromPatient > 0) casePrice = Math.max(casePrice, fromPatient);
  }

  const paidFromOps = ops.reduce((s, row) => s + num(row.paid_amount), 0);
  const totalPaid = patientRow
    ? Math.max(num(patientRow.total_paid), paidFromOps)
    : paidFromOps;

  const discount = patientRow ? num(patientRow.discount_total) : 0;

  const last = ops[ops.length - 1];
  let remaining = num(last.remaining_debt);
  if (remaining <= 0) {
    remaining = Math.max(0, num(last.total_amount) - num(last.paid_amount));
  }

  const finalPrice =
    patientRow && num(patientRow.agreed_total) > 0
      ? num(patientRow.agreed_total)
      : casePrice > 0
        ? Math.max(0, casePrice - discount)
        : totalPaid + remaining;

  if (casePrice <= 0 && finalPrice > 0) {
    casePrice = finalPrice + discount;
  }

  if (finalPrice <= 0 && totalPaid <= 0 && remaining <= 0) {
    return null;
  }

  if (remaining <= 0 && finalPrice > 0) {
    remaining = Math.max(0, finalPrice - totalPaid);
  }

  return buildPlan({
    case_price: casePrice,
    discount_total: discount,
    final_price: finalPrice,
    doctor_share_total: patientRow ? num(patientRow.doctor_share_total) : 0,
    clinic_share_total: patientRow ? num(patientRow.clinic_share_total) : 0,
    total_paid: totalPaid,
    financial_locked: true,
    treatment_status:
      finalPrice > 0 && totalPaid >= finalPrice ? "completed" : "active",
  });
}

function resolvePatientFinancialPlanFromRows(
  tp: Record<string, unknown> | null | undefined,
  patient: Record<string, unknown> | null | undefined,
  ops: Record<string, unknown>[]
): PatientFinancialPlan {
  if (tp) {
    const casePrice = num(tp.case_price);
    const discount = num(tp.discount_total);
    const finalPrice = num(tp.final_price) || Math.max(0, casePrice - discount);
    const paid = num(tp.total_paid);
    const status = tp.status === "completed" ? "completed" : "active";
    const fromTable = buildPlan({
      case_price: casePrice,
      discount_total: discount,
      final_price: finalPrice,
      doctor_share_total: num(tp.doctor_share_total),
      clinic_share_total: num(tp.clinic_share_total),
      total_paid: paid,
      financial_locked: true,
      treatment_status:
        status === "completed" || (finalPrice > 0 && paid >= finalPrice)
          ? "completed"
          : "active",
    });
    if (hasTreatmentPlan(fromTable)) return fromTable;
  }

  if (patient) {
    const casePrice =
      num(patient.original_agreed_total) ||
      num(patient.previous_total) ||
      num(patient.agreed_total);
    const discount = num(patient.discount_total);
    const finalPrice =
      num(patient.agreed_total) || Math.max(0, casePrice - discount);
    const paid = num(patient.total_paid);
    const locked =
      Boolean(patient.financial_locked) || casePrice > 0 || finalPrice > 0;
    const status =
      patient.treatment_status === "completed" ? "completed" : "active";

    const fromPatient = buildPlan({
      case_price: casePrice,
      discount_total: discount,
      final_price: finalPrice,
      doctor_share_total: num(patient.doctor_share_total),
      clinic_share_total: num(patient.clinic_share_total),
      total_paid: paid,
      financial_locked: locked,
      treatment_status:
        status === "completed" || (finalPrice > 0 && paid >= finalPrice)
          ? "completed"
          : "active",
    });

    if (hasTreatmentPlan(fromPatient)) return fromPatient;
  }

  const inferred = inferPlanFromOperationRows(ops, patient ?? null);
  if (inferred) return inferred;

  return emptyPlan();
}

/** خطط مالية لعدة مراجعين — 3 استعلامات بدل 3×N */
export async function fetchPatientFinancialPlansBatch(
  supabase: SupabaseClient,
  patientIds: string[]
): Promise<Map<string, PatientFinancialPlan>> {
  const result = new Map<string, PatientFinancialPlan>();
  if (!patientIds.length) return result;

  const [plansRes, patientsRes, opsRes] = await Promise.all([
    supabase
      .from("patient_treatment_plans")
      .select("*")
      .in("patient_id", patientIds),
    supabase.from("patients").select("*").in("id", patientIds),
    supabase
      .from("patient_operations")
      .select(
        "patient_id, total_amount, paid_amount, remaining_debt, session_kind, created_at"
      )
      .in("patient_id", patientIds)
      .order("created_at", { ascending: true }),
  ]);

  const planByPatient = new Map<string, Record<string, unknown>>();
  for (const row of plansRes.data ?? []) {
    planByPatient.set(row.patient_id as string, row as Record<string, unknown>);
  }

  const patientById = new Map<string, Record<string, unknown>>();
  for (const row of patientsRes.data ?? []) {
    patientById.set(row.id as string, row as Record<string, unknown>);
  }

  const opsByPatient = new Map<string, Record<string, unknown>[]>();
  for (const row of opsRes.data ?? []) {
    const pid = row.patient_id as string;
    const list = opsByPatient.get(pid) ?? [];
    list.push(row as Record<string, unknown>);
    opsByPatient.set(pid, list);
  }

  for (const patientId of patientIds) {
    result.set(
      patientId,
      resolvePatientFinancialPlanFromRows(
        planByPatient.get(patientId),
        patientById.get(patientId),
        opsByPatient.get(patientId) ?? []
      )
    );
  }

  return result;
}

export function buildPlanFromCaseRow(p: {
  case_price: number;
  discount_total: number;
  final_price: number;
  doctor_share_total: number;
  clinic_share_total: number;
  total_paid: number;
  status?: TreatmentStatus;
  financial_locked?: boolean;
}): PatientFinancialPlan {
  const finalPrice = p.final_price;
  const remaining = Math.max(0, finalPrice - p.total_paid);
  const treatment_status = treatmentStatusFromAmounts(finalPrice, p.total_paid);
  return {
    case_price: p.case_price,
    discount_total: p.discount_total,
    final_price: finalPrice,
    agreed_total: finalPrice,
    original_agreed_total: p.case_price,
    doctor_share_total: p.doctor_share_total,
    clinic_share_total: p.clinic_share_total,
    total_paid: p.total_paid,
    remaining_balance: remaining,
    financial_locked: p.financial_locked ?? true,
    treatment_status,
  };
}

function buildPlan(p: {
  case_price: number;
  discount_total: number;
  final_price: number;
  doctor_share_total: number;
  clinic_share_total: number;
  total_paid: number;
  financial_locked: boolean;
  treatment_status: TreatmentStatus;
}): PatientFinancialPlan {
  return buildPlanFromCaseRow({
    ...p,
    status: p.treatment_status,
    financial_locked: p.financial_locked,
  });
}

function emptyPlan(): PatientFinancialPlan {
  return buildPlan({
    case_price: 0,
    discount_total: 0,
    final_price: 0,
    doctor_share_total: 0,
    clinic_share_total: 0,
    total_paid: 0,
    financial_locked: false,
    treatment_status: "active",
  });
}

function num(v: unknown): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

export function computeFinalPrice(casePrice: number, discount: number): number {
  return Math.max(0, casePrice - discount);
}

/**
 * السعر النهائي = السعر الكلي − مجموع كل الخصومات (المحفوظ + إضافي هذه الجلسة)
 */
export function computeFinalPriceWithDiscounts(
  planOrCasePrice: PatientFinancialPlan | number,
  sessionAdditionalDiscount = 0
): number {
  if (typeof planOrCasePrice === "number") {
    return Math.max(0, planOrCasePrice - sessionAdditionalDiscount);
  }
  const plan = planOrCasePrice;
  const totalDiscount = plan.discount_total + sessionAdditionalDiscount;
  return Math.max(0, plan.case_price - totalDiscount);
}

/**
 * الرصيد المتبقي (الذمة) = السعر النهائي − مجموع المدفوعات − دفعة هذه الجلسة
 */
/** هامش تقريب للدينار — اعتبار الذمة مسددة */
export const FINANCIAL_EPSILON = 0.01;

export function computePatientDebtRemaining(
  plan: PatientFinancialPlan,
  opts: { additionalDiscount?: number; newPayment?: number } = {}
): number {
  const finalPrice = computeFinalPriceWithDiscounts(
    plan,
    opts.additionalDiscount ?? 0
  );
  const pay = opts.newPayment ?? 0;
  return Math.max(0, finalPrice - plan.total_paid - pay);
}

/** هل تُسدَّد الحالة بالكامل بعد هذه الجلسة؟ */
export function isCaseFullySettled(
  plan: PatientFinancialPlan,
  opts: { additionalDiscount?: number; newPayment?: number } = {}
): boolean {
  if (plan.final_price <= 0 && plan.case_price <= 0) return false;
  return computePatientDebtRemaining(plan, opts) <= FINANCIAL_EPSILON;
}

/** المتبقي المحسوب من الأرقام — لا نعتمد على remaining_balance المخزّن فقط */
export function computedCaseRemaining(plan: PatientFinancialPlan): number {
  return Math.max(0, plan.final_price - plan.total_paid);
}

/**
 * علاج مكتمل = سداد كامل ذمة هذه الحالة (من السعر النهائي − المدفوع).
 */
export function isTreatmentCaseComplete(
  plan: PatientFinancialPlan
): boolean {
  if (plan.final_price <= FINANCIAL_EPSILON) return false;
  if (plan.total_paid <= 0) return false;
  return computedCaseRemaining(plan) <= FINANCIAL_EPSILON;
}

/** تظهر في قائمة «الطبيب اليوم» — أي حالة عليها ذمة (الحكم من الأرقام لا من status في DB) */
export function isTreatmentCaseOpenForPicker(
  plan: PatientFinancialPlan
): boolean {
  const rem = computedCaseRemaining(plan);
  if (rem <= FINANCIAL_EPSILON) return false;
  return (
    plan.final_price > FINANCIAL_EPSILON ||
    plan.total_paid > FINANCIAL_EPSILON ||
    plan.case_price > FINANCIAL_EPSILON
  );
}

/** قسم «حالات مكتملة» — مسددة فعلاً (متبقي ≈ 0) */
export function isTreatmentCaseSettledForPicker(
  plan: PatientFinancialPlan
): boolean {
  if (plan.final_price <= FINANCIAL_EPSILON) return false;
  if (plan.total_paid <= FINANCIAL_EPSILON) return false;
  return computedCaseRemaining(plan) <= FINANCIAL_EPSILON;
}

export function treatmentStatusFromAmounts(
  finalPrice: number,
  totalPaid: number
): TreatmentStatus {
  const rem = Math.max(0, finalPrice - totalPaid);
  return finalPrice > 0 && rem <= FINANCIAL_EPSILON && totalPaid > 0
    ? "completed"
    : "active";
}

export function computeRemainingBalance(
  finalPrice: number,
  totalPaid: number,
  newPayment = 0
): number {
  return Math.max(0, finalPrice - totalPaid - newPayment);
}

function doctorShareInput(doctor: Doctor): DoctorShareInput {
  return {
    percentage: doctor.percentage as DoctorPercentage,
    materials_share: doctor.materials_share as MaterialsCostShare,
    payment_type: doctor.payment_type,
    financial_agreement: doctor.financial_agreement,
  };
}

/** Split once on treatment final (after discount), not per payment session */
export function previewTreatmentSplit(
  finalPrice: number,
  materialsCost: number,
  doctor: Doctor | null
): { doctorShare: number; clinicShare: number } | null {
  if (!doctor || finalPrice <= 0) return null;
  return calculateDoctorShareForDoctor(finalPrice, doctorShareInput(doctor), materialsCost);
}

/** حصة الطبيب/العيادة — من الحالة المحفوظة أو حساب مباشر من اتفاق الطبيب */
export function resolveCaseFinancialSplit(
  plan: PatientFinancialPlan,
  doctor: Doctor | null,
  opts?: { materialsCost?: number; reviewFee?: number }
): { doctorShare: number; clinicShare: number; agreedTotal: number } | null {
  if (plan.final_price <= 0) return null;

  const agreedTotal = plan.final_price;
  const storedDoctor = plan.doctor_share_total;
  const storedClinic = plan.clinic_share_total;

  if (storedDoctor > 0 || storedClinic > 0) {
    return {
      agreedTotal,
      doctorShare: storedDoctor,
      clinicShare:
        storedClinic > 0
          ? storedClinic
          : Math.max(0, agreedTotal - storedDoctor),
    };
  }

  const reviewFee = opts?.reviewFee ?? 0;
  const materials = opts?.materialsCost ?? 0;
  const treatmentFinal = Math.max(0, agreedTotal - reviewFee);

  return previewTreatmentSplitWithReview(
    treatmentFinal,
    reviewFee,
    materials,
    doctor
  );
}

/** علاج + كشفية: الكشفية بالكامل للعيادة */
export function previewTreatmentSplitWithReview(
  treatmentFinal: number,
  reviewFee: number,
  materialsCost: number,
  doctor: Doctor | null
): { doctorShare: number; clinicShare: number; agreedTotal: number } | null {
  return splitTreatmentAndReviewFee(
    treatmentFinal,
    reviewFee,
    materialsCost,
    doctor ? doctorShareInput(doctor) : null
  );
}

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * توزيع المبلغ المدفوع في هذه الجلسة — نفس منطق قاعدة البيانات:
 * paid × (حصة الحالة / السعر النهائي)
 */
export function previewPaidSessionSplit(opts: {
  paidAmount: number;
  caseFinalPrice: number;
  caseDoctorShare: number;
  caseClinicShare: number;
  doctor: Doctor | null;
}): { doctorShare: number; clinicShare: number; paidAmount: number } | null {
  const paid = Math.max(0, opts.paidAmount);
  if (paid <= 0) return null;

  const finalPrice = Math.max(0, opts.caseFinalPrice);
  let caseDoc = Math.max(0, opts.caseDoctorShare);
  let caseClinic = Math.max(0, opts.caseClinicShare);

  if (caseDoc <= 0 && caseClinic <= 0 && finalPrice > 0 && opts.doctor) {
    const full = previewTreatmentSplit(finalPrice, 0, opts.doctor);
    if (full) {
      caseDoc = full.doctorShare;
      caseClinic = full.clinicShare;
    }
  }

  if (opts.doctor && isSalaryDoctor(opts.doctor)) {
    return { paidAmount: paid, doctorShare: 0, clinicShare: roundMoney(paid) };
  }

  if (finalPrice > 0 && (caseDoc > 0 || caseClinic > 0)) {
    return {
      paidAmount: paid,
      doctorShare: roundMoney((paid * caseDoc) / finalPrice),
      clinicShare: roundMoney((paid * caseClinic) / finalPrice),
    };
  }

  if (opts.doctor && finalPrice <= 0) {
    const pct = Number(opts.doctor.percentage ?? 50) / 100;
    const doc = roundMoney(paid * pct);
    return {
      paidAmount: paid,
      doctorShare: doc,
      clinicShare: roundMoney(Math.max(0, paid - doc)),
    };
  }

  return null;
}

export function resolveSessionKind(
  plan: PatientFinancialPlan,
  forceNewPlan?: boolean
): SessionKind {
  if (forceNewPlan) return "plan";
  if (hasTreatmentPlan(plan)) return "payment";
  return "plan";
}

export function isTreatmentCaseClosed(plan: PatientFinancialPlan): boolean {
  return isTreatmentCaseComplete(plan);
}

/** Persist plan + discount on first session when DB trigger is not migrated */
export async function saveFirstSessionPlanFallback(
  supabase: SupabaseClient,
  patientId: string,
  clinicId: string,
  casePrice: number,
  discount: number,
  paid: number,
  doctorShare: number,
  clinicShare: number
): Promise<{ ok: boolean; error?: string }> {
  const finalPrice = computeFinalPrice(casePrice, discount);
  const completed = finalPrice > 0 && paid >= finalPrice;

  const patientPatch = {
    agreed_total: finalPrice,
    original_agreed_total: casePrice,
    discount_total: discount,
    doctor_share_total: doctorShare,
    clinic_share_total: clinicShare,
    previous_total: casePrice,
    financial_locked: true,
    treatment_status: completed ? "completed" : "active",
    total_paid: paid,
  };

  const { error: pErr } = await supabase
    .from("patients")
    .update(patientPatch)
    .eq("id", patientId);

  if (pErr) return { ok: false, error: pErr.message };

  const planRow = {
    patient_id: patientId,
    clinic_id: clinicId,
    case_price: casePrice,
    discount_total: discount,
    final_price: finalPrice,
    doctor_share_total: doctorShare,
    clinic_share_total: clinicShare,
    total_paid: paid,
    status: completed ? "completed" : "active",
    locked_at: new Date().toISOString(),
  };

  const { error: tErr } = await supabase
    .from("patient_treatment_plans")
    .upsert(planRow, { onConflict: "patient_id" });

  if (tErr && !tErr.message.includes("patient_treatment_plans")) {
    return { ok: false, error: tErr.message };
  }

  return { ok: true };
}

/** خصم إضافي في جلسة متابعة (يُجمع على discount_total ويُخفّض final_price) */
export async function applyAdditionalDiscountFallback(
  supabase: SupabaseClient,
  patientId: string,
  plan: PatientFinancialPlan,
  additionalAmount: number
): Promise<{ ok: boolean; error?: string }> {
  if (additionalAmount <= 0) return { ok: true };

  const newDiscountTotal = plan.discount_total + additionalAmount;
  const newFinal = Math.max(0, plan.case_price - newDiscountTotal);
  if (newFinal <= 0 && plan.case_price > 0) {
    return { ok: false, error: "الخصم الإضافي أكبر من الرصيد المتبقي" };
  }

  const ratio =
    plan.final_price > 0 ? newFinal / plan.final_price : 0;
  const completed =
    newFinal > 0 && plan.total_paid >= newFinal;

  const patch = {
    discount_total: newDiscountTotal,
    agreed_total: newFinal,
    doctor_share_total:
      Math.round(plan.doctor_share_total * ratio * 100) / 100,
    clinic_share_total:
      Math.round(plan.clinic_share_total * ratio * 100) / 100,
    treatment_status: completed ? "completed" : "active",
  };

  const { error: pErr } = await supabase
    .from("patients")
    .update(patch)
    .eq("id", patientId);

  if (pErr) return { ok: false, error: pErr.message };

  const { error: tErr } = await supabase
    .from("patient_treatment_plans")
    .update({
      discount_total: newDiscountTotal,
      final_price: newFinal,
      doctor_share_total: patch.doctor_share_total,
      clinic_share_total: patch.clinic_share_total,
      status: completed ? "completed" : "active",
      updated_at: new Date().toISOString(),
    })
    .eq("patient_id", patientId);

  if (tErr && !tErr.message.includes("patient_treatment_plans")) {
    return { ok: false, error: tErr.message };
  }

  return { ok: true };
}
