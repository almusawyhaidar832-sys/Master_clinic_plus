import type { SupabaseClient } from "@supabase/supabase-js";
import { opDebt, opName } from "@/types";
import type { PatientOperation } from "@/types";
import {
  buildPlanFromCaseRow,
  treatmentStatusFromAmounts,
  type PatientFinancialPlan,
} from "@/lib/services/patient-financial-plan";

export interface PatientTreatmentCase extends PatientFinancialPlan {
  id: string;
  treatment_name_ar: string;
}

function num(v: unknown): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

export function treatmentNameKey(name: string): string {
  return name.trim().toLowerCase() || "علاج";
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

/** Group operations into cases by procedure name (جسر أسنان، حشوة، …) */
function inferCasesFromOperations(
  ops: PatientOperation[],
  patientId: string
): PatientTreatmentCase[] {
  const groups = new Map<
    string,
    {
      name: string;
      casePrice: number;
      totalPaid: number;
      lastRemaining: number;
      discount: number;
      doctorShare: number;
      clinicShare: number;
    }
  >();

  for (const op of ops) {
    const name = opName(op).trim() || "علاج";
    const key = slugKey(name);
    if (!groups.has(key)) {
      groups.set(key, {
        name,
        casePrice: 0,
        totalPaid: 0,
        lastRemaining: 0,
        discount: 0,
        doctorShare: 0,
        clinicShare: 0,
      });
    }
    const g = groups.get(key)!;
    const total = num(op.total_amount);
    if (total > 0) g.casePrice = Math.max(g.casePrice, total);
    g.totalPaid += num(op.paid_amount);
    g.lastRemaining = opDebt(op);
    if (num(op.doctor_share_amount) > 0) {
      g.doctorShare = num(op.doctor_share_amount);
    }
    if (num(op.clinic_share_amount) > 0) {
      g.clinicShare = num(op.clinic_share_amount);
    }
  }

  const cases: PatientTreatmentCase[] = [];
  let idx = 0;

  for (const g of groups.values()) {
    let casePrice = g.casePrice;
    if (casePrice <= 0 && g.totalPaid > 0) {
      casePrice = g.totalPaid + g.lastRemaining;
    }
    if (casePrice <= 0 && g.lastRemaining > 0) {
      casePrice = g.lastRemaining;
    }
    if (casePrice <= 0 && g.totalPaid <= 0) continue;

    const finalPrice = Math.max(0, casePrice - g.discount);
    const remaining = Math.max(0, finalPrice - g.totalPaid);

    const plan = buildPlanFromCaseRow({
      case_price: casePrice,
      discount_total: g.discount,
      final_price: finalPrice,
      doctor_share_total: g.doctorShare,
      clinic_share_total: g.clinicShare,
      total_paid: g.totalPaid,
      status: treatmentStatusFromAmounts(finalPrice, g.totalPaid),
    });

    cases.push({
      ...plan,
      id: `inferred-${patientId}-${idx++}`,
      treatment_name_ar: g.name,
    });
  }

  return cases.sort((a, b) => {
    if (a.treatment_status !== b.treatment_status) {
      return a.treatment_status === "active" ? -1 : 1;
    }
    return b.remaining_balance - a.remaining_balance;
  });
}

/** حالات العلاج من سجل الجلسات (للعرض والذمة) */
export function inferTreatmentCasesFromOperations(
  ops: PatientOperation[],
  patientId = "local"
): PatientTreatmentCase[] {
  return inferCasesFromOperations(ops, patientId);
}

/**
 * الذمة الحقيقية = لكل حالة (سعر نهائي − مجموع المدفوعات)، وليس جمع remaining_debt لكل جلسة.
 */
export function computeOutstandingDebtFromOperations(
  ops: PatientOperation[],
  patientId = "local"
): number {
  return inferTreatmentCasesFromOperations(ops, patientId).reduce(
    (s, c) => s + Math.max(0, c.remaining_balance),
    0
  );
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
    status: row.status === "completed" ? "completed" : "active",
  });
  return {
    ...plan,
    id: String(row.id),
    treatment_name_ar: String(row.treatment_name_ar ?? "علاج").trim(),
  };
}

/** دمج: أرقام الجلسات (مستنتجة) هي المصدر — DB يوفّر فقط id والحصص */
function mergeCases(
  dbCases: PatientTreatmentCase[],
  inferred: PatientTreatmentCase[]
): PatientTreatmentCase[] {
  const byName = new Map<string, PatientTreatmentCase>();

  for (const inf of inferred.filter(isValidCase)) {
    byName.set(slugKey(inf.treatment_name_ar), inf);
  }

  for (const db of dbCases.filter(isValidCase)) {
    const key = slugKey(db.treatment_name_ar);
    const inf = byName.get(key);
    if (inf) {
      byName.set(key, {
        ...inf,
        id: db.id,
        doctor_share_total: db.doctor_share_total || inf.doctor_share_total,
        clinic_share_total: db.clinic_share_total || inf.clinic_share_total,
      });
    } else {
      byName.set(key, db);
    }
  }

  return Array.from(byName.values())
    .map(finalizeTreatmentCase)
    .sort((a, b) => {
      if (a.treatment_status !== b.treatment_status) {
        return a.treatment_status === "active" ? -1 : 1;
      }
      return b.remaining_balance - a.remaining_balance;
    });
}

export async function fetchPatientTreatmentCases(
  supabase: SupabaseClient,
  patientId: string,
  _clinicId?: string
): Promise<PatientTreatmentCase[]> {
  const { data: rows, error } = await supabase
    .from("patient_treatment_cases")
    .select("*")
    .eq("patient_id", patientId)
    .order("created_at", { ascending: false });

  const dbCases =
    !error && rows?.length
      ? rows.map((row) => mapDbRow(row as Record<string, unknown>))
      : [];

  const { data: ops, error: opsErr } = await supabase
    .from("patient_operations")
    .select("*")
    .eq("patient_id", patientId)
    .order("created_at", { ascending: true });

  if (opsErr || !ops?.length) {
    return dbCases.filter(isValidCase);
  }

  const inferred = inferCasesFromOperations(ops as PatientOperation[], patientId);
  const merged = mergeCases(dbCases, inferred);

  const list =
    merged.length > 0 ? merged : inferred.map(finalizeTreatmentCase);

  void reconcileCasesToDatabase(supabase, list);

  return list;
}

/** تصحيح صف DB إذا كان status مكتمل والذمة لا تزال > 0 */
async function reconcileCasesToDatabase(
  supabase: SupabaseClient,
  cases: PatientTreatmentCase[]
): Promise<void> {
  for (const c of cases) {
    if (c.id.startsWith("inferred-")) continue;
    if (c.remaining_balance <= 0 && c.treatment_status === "completed") continue;

    await supabase
      .from("patient_treatment_cases")
      .update({
        case_price: c.case_price,
        discount_total: c.discount_total,
        final_price: c.final_price,
        total_paid: c.total_paid,
        status: c.treatment_status,
        updated_at: new Date().toISOString(),
      })
      .eq("id", c.id);
  }
}

/** إعادة حساب المتبقي والحالة من الأرقام — لا نثق بـ status القديم في DB */
function finalizeTreatmentCase(c: PatientTreatmentCase): PatientTreatmentCase {
  const finalPrice = c.final_price;
  const remaining = Math.max(0, finalPrice - c.total_paid);
  const treatment_status = treatmentStatusFromAmounts(finalPrice, c.total_paid);
  return {
    ...c,
    remaining_balance: remaining,
    treatment_status,
  };
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
  }
): Promise<{ case: PatientTreatmentCase | null; error?: string }> {
  const finalPrice = Math.max(0, input.casePrice - input.discount);
  const status = treatmentStatusFromAmounts(finalPrice, input.paid);

  const row = {
    patient_id: input.patientId,
    clinic_id: input.clinicId,
    treatment_name_ar: input.treatmentName.trim(),
    case_price: input.casePrice,
    discount_total: input.discount,
    final_price: finalPrice,
    doctor_share_total: input.doctorShare,
    clinic_share_total: input.clinicShare,
    total_paid: input.paid,
    status,
  };

  const { data, error } = await supabase
    .from("patient_treatment_cases")
    .insert(row)
    .select("*")
    .single();

  if (error) return { case: null, error: error.message };

  return { case: mapDbRow(data as Record<string, unknown>) };
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

/**
 * بعد دفعة أو خصم — يحدّث حالة العلاج في DB ويُغلقها عند سداد الذمة كاملة.
 */
export async function syncTreatmentCaseAfterSession(
  supabase: SupabaseClient,
  input: {
    patientId: string;
    clinicId: string;
    treatmentName: string;
    plan: PatientFinancialPlan;
    paidDelta: number;
    additionalDiscount?: number;
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

  const { data: rows } = await supabase
    .from("patient_treatment_cases")
    .select("id, treatment_name_ar")
    .eq("patient_id", input.patientId);

  const existing = (rows ?? []).find(
    (r) => slugKey(String(r.treatment_name_ar ?? "")) === key
  );

  if (existing?.id) {
    const upd = await updateTreatmentCasePayment(
      supabase,
      String(existing.id),
      input.paidDelta,
      addDisc
    );
    return {
      ok: upd.ok,
      completed: upd.completed ?? status === "completed",
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

  if (status === "completed" && created.case.treatment_status !== "completed") {
    await supabase
      .from("patient_treatment_cases")
      .update({ status: "completed", updated_at: new Date().toISOString() })
      .eq("id", created.case.id);
  }

  return {
    ok: true,
    completed: status === "completed",
    caseId: created.case.id,
  };
}

export function caseToFinancialPlan(c: PatientTreatmentCase): PatientFinancialPlan {
  const { id: _id, treatment_name_ar: _n, ...plan } = c;
  return plan;
}
