import type { SupabaseClient } from "@supabase/supabase-js";
import { calculateDoctorShareForDoctor } from "@/lib/finance";
import {
  opName,
  type Doctor,
  type DoctorPercentage,
  type MaterialsCostShare,
} from "@/types";

export interface SessionRefund {
  id: string;
  clinic_id: string;
  session_id: string;
  patient_id: string;
  doctor_id: string;
  treatment_case_id: string | null;
  amount: number;
  doctor_share_deduction: number;
  clinic_share_deduction: number;
  reason: string;
  accounting_operation_id: string | null;
  created_by: string | null;
  created_at: string;
}

export interface RefundShareSplit {
  doctorShareDeduction: number;
  clinicShareDeduction: number;
}

export function computeRefundShareSplit(
  amount: number,
  doctor: Pick<
    Doctor,
    "percentage" | "materials_share" | "payment_type" | "financial_agreement"
  > | null
): RefundShareSplit {
  const refundAmount = Math.max(0, amount);
  if (refundAmount <= 0) {
    return { doctorShareDeduction: 0, clinicShareDeduction: 0 };
  }
  if (!doctor) {
    return {
      doctorShareDeduction: 0,
      clinicShareDeduction: Math.round(refundAmount * 100) / 100,
    };
  }
  const { doctorShare, clinicShare } = calculateDoctorShareForDoctor(
    refundAmount,
    {
      percentage: doctor.percentage,
      materials_share: doctor.materials_share,
      payment_type: doctor.payment_type,
      financial_agreement: doctor.financial_agreement,
    },
    0
  );
  return {
    doctorShareDeduction: doctorShare,
    clinicShareDeduction: clinicShare,
  };
}

export async function fetchRefundedTotalForSession(
  supabase: SupabaseClient,
  sessionId: string
): Promise<number> {
  const { data } = await supabase
    .from("session_refunds")
    .select("amount")
    .eq("session_id", sessionId);

  return (data ?? []).reduce((s, r) => s + Number(r.amount ?? 0), 0);
}

export async function createSessionRefund(
  supabase: SupabaseClient,
  input: {
    clinicId: string;
    sessionId: string;
    amount: number;
    reason: string;
    createdBy: string;
  }
): Promise<{ refund: SessionRefund; error?: string }> {
  const amount = Math.round(Number(input.amount) * 100) / 100;
  const reason = input.reason.trim();

  if (!input.sessionId || amount <= 0) {
    return { refund: null as unknown as SessionRefund, error: "أدخل مبلغاً صالحاً" };
  }
  if (!reason) {
    return { refund: null as unknown as SessionRefund, error: "سبب الإرجاع مطلوب" };
  }

  const { data: session, error: sessionErr } = await supabase
    .from("patient_operations")
    .select(
      "id, clinic_id, patient_id, doctor_id, treatment_case_id, paid_amount, operation_date, operation_name_ar, session_kind"
    )
    .eq("id", input.sessionId)
    .maybeSingle();

  if (sessionErr) {
    return {
      refund: null as unknown as SessionRefund,
      error: sessionErr.message || "تعذر قراءة الجلسة",
    };
  }
  if (!session) {
    return { refund: null as unknown as SessionRefund, error: "الجلسة غير موجودة" };
  }
  if (session.clinic_id !== input.clinicId) {
    return { refund: null as unknown as SessionRefund, error: "غير مصرح" };
  }
  if (session.session_kind === "refund") {
    return {
      refund: null as unknown as SessionRefund,
      error: "لا يمكن الإرجاع من قيد محاسبي للإرجاع",
    };
  }

  const sessionPaid = Number(session.paid_amount ?? 0);
  if (sessionPaid <= 0) {
    return {
      refund: null as unknown as SessionRefund,
      error: "لا يوجد مبلغ مدفوع في هذه الجلسة للإرجاع",
    };
  }

  const alreadyRefunded = await fetchRefundedTotalForSession(
    supabase,
    input.sessionId
  );
  const maxRefundable = Math.round((sessionPaid - alreadyRefunded) * 100) / 100;

  if (amount > maxRefundable + 0.001) {
    return {
      refund: null as unknown as SessionRefund,
      error: `المبلغ يتجاوز القابل للإرجاع (${maxRefundable})`,
    };
  }

  const { data: doctor, error: doctorErr } = await supabase
    .from("doctors")
    .select("id, percentage, materials_share, payment_type")
    .eq("id", session.doctor_id)
    .maybeSingle();

  if (doctorErr || !doctor) {
    return { refund: null as unknown as SessionRefund, error: "بيانات الطبيب غير متوفرة" };
  }

  const split = computeRefundShareSplit(amount, {
    percentage: doctor.percentage as DoctorPercentage,
    materials_share: doctor.materials_share as MaterialsCostShare,
    payment_type: doctor.payment_type as Doctor["payment_type"],
  });

  const sessionLabel = opName(session as Parameters<typeof opName>[0]) || "إرجاع";
  const today = new Date().toISOString().slice(0, 10);

  const { data: accountingOp, error: opErr } = await supabase
    .from("patient_operations")
    .insert({
      clinic_id: input.clinicId,
      patient_id: session.patient_id,
      doctor_id: session.doctor_id,
      treatment_case_id: session.treatment_case_id,
      operation_name_ar: `${sessionLabel} — إرجاع`,
      operation_date: today,
      total_amount: 0,
      paid_amount: -amount,
      session_kind: "refund",
      doctor_share_amount: -split.doctorShareDeduction,
      clinic_share_amount: -split.clinicShareDeduction,
      notes: reason,
    })
    .select("id")
    .single();

  if (opErr || !accountingOp) {
    return {
      refund: null as unknown as SessionRefund,
      error: opErr?.message ?? "تعذر إنشاء القيد المحاسبي",
    };
  }

  const { data: refund, error: refundErr } = await supabase
    .from("session_refunds")
    .insert({
      clinic_id: input.clinicId,
      session_id: input.sessionId,
      patient_id: session.patient_id,
      doctor_id: session.doctor_id,
      treatment_case_id: session.treatment_case_id,
      amount,
      doctor_share_deduction: split.doctorShareDeduction,
      clinic_share_deduction: split.clinicShareDeduction,
      reason,
      accounting_operation_id: accountingOp.id,
      created_by: input.createdBy,
    })
    .select("*")
    .single();

  if (refundErr || !refund) {
    await supabase
      .from("patient_operations")
      .delete()
      .eq("id", accountingOp.id);
    return {
      refund: null as unknown as SessionRefund,
      error: refundErr?.message ?? "تعذر حفظ سجل الإرجاع",
    };
  }

  return { refund: refund as SessionRefund };
}

export interface RefundReportRow {
  id: string;
  patientName: string;
  amount: number;
  doctorName: string;
  date: string;
  reason: string;
}

export interface RefundableSessionRow {
  id: string;
  patientId: string;
  patientName: string;
  doctorId: string;
  doctorName: string;
  operationName: string;
  operationDate: string;
  paidAmount: number;
  refundedAmount: number;
  maxRefundable: number;
  sessionKind: string;
}

export interface RefundHistoryRow {
  id: string;
  sessionId: string;
  patientName: string;
  doctorName: string;
  amount: number;
  reason: string;
  createdAt: string;
}

function relationOneName(
  rel: { full_name_ar: string } | { full_name_ar: string }[] | null | undefined
): string {
  if (!rel) return "—";
  const name = Array.isArray(rel) ? rel[0]?.full_name_ar : rel.full_name_ar;
  return name?.trim() || "—";
}

async function refundedTotalsBySession(
  supabase: SupabaseClient,
  sessionIds: string[]
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (sessionIds.length === 0) return map;

  const { data } = await supabase
    .from("session_refunds")
    .select("session_id, amount")
    .in("session_id", sessionIds);

  for (const row of data ?? []) {
    const sid = String(row.session_id);
    map.set(sid, (map.get(sid) ?? 0) + Number(row.amount ?? 0));
  }
  return map;
}

function mapOpToRefundableRow(
  op: {
    id: string;
    patient_id: string;
    doctor_id: string;
    paid_amount: number | string | null;
    operation_date?: string | null;
    operation_name_ar?: string | null;
    session_kind?: string | null;
    created_at?: string | null;
    patient?: { full_name_ar: string } | { full_name_ar: string }[] | null;
    doctor?: { full_name_ar: string } | { full_name_ar: string }[] | null;
  },
  refundedMap: Map<string, number>
): RefundableSessionRow | null {
  if (op.session_kind === "refund") return null;
  const paid = Number(op.paid_amount ?? 0);
  if (paid <= 0) return null;

  const refunded = Math.round((refundedMap.get(op.id) ?? 0) * 100) / 100;
  const maxRefundable = Math.round((paid - refunded) * 100) / 100;
  if (maxRefundable <= 0.001) return null;

  const date =
    op.operation_date?.slice(0, 10) ||
    op.created_at?.slice(0, 10) ||
    "—";

  return {
    id: op.id,
    patientId: op.patient_id,
    patientName: relationOneName(op.patient),
    doctorId: op.doctor_id,
    doctorName: relationOneName(op.doctor),
    operationName: String(op.operation_name_ar ?? "جلسة").trim() || "جلسة",
    operationDate: date,
    paidAmount: paid,
    refundedAmount: refunded,
    maxRefundable,
    sessionKind: String(op.session_kind ?? "payment"),
  };
}

const REFUNDABLE_OP_SELECT =
  "id, patient_id, doctor_id, paid_amount, operation_date, operation_name_ar, session_kind, created_at, patient:patients!patient_id(full_name_ar), doctor:doctors!doctor_id(full_name_ar)";

/** جلسات قابلة للإرجاع — حسب الطبيب */
export async function fetchRefundableSessionsByDoctor(
  supabase: SupabaseClient,
  doctorId: string,
  limit = 80
): Promise<RefundableSessionRow[]> {
  const { data, error } = await supabase
    .from("patient_operations")
    .select(REFUNDABLE_OP_SELECT)
    .eq("doctor_id", doctorId)
    .gt("paid_amount", 0)
    .neq("session_kind", "refund")
    .order("operation_date", { ascending: false })
    .limit(limit);

  if (error || !data?.length) return [];

  const refundedMap = await refundedTotalsBySession(
    supabase,
    data.map((r) => r.id as string)
  );

  return data
    .map((op) => mapOpToRefundableRow(op, refundedMap))
    .filter((r): r is RefundableSessionRow => !!r);
}

/** جلسات قابلة للإرجاع — حسب معرّفات مراجعين */
export async function fetchRefundableSessionsByPatients(
  supabase: SupabaseClient,
  patientIds: string[],
  limit = 80
): Promise<RefundableSessionRow[]> {
  if (patientIds.length === 0) return [];

  const { data, error } = await supabase
    .from("patient_operations")
    .select(REFUNDABLE_OP_SELECT)
    .in("patient_id", patientIds)
    .gt("paid_amount", 0)
    .neq("session_kind", "refund")
    .order("operation_date", { ascending: false })
    .limit(limit);

  if (error || !data?.length) return [];

  const refundedMap = await refundedTotalsBySession(
    supabase,
    data.map((r) => r.id as string)
  );

  return data
    .map((op) => mapOpToRefundableRow(op, refundedMap))
    .filter((r): r is RefundableSessionRow => !!r);
}

/** سجل المرتجعات الأخير للوحة التحكم */
export async function fetchRefundHistory(
  supabase: SupabaseClient,
  limit = 50
): Promise<RefundHistoryRow[]> {
  const { data } = await supabase
    .from("session_refunds")
    .select(
      "id, session_id, amount, reason, created_at, patient:patients!patient_id(full_name_ar), doctor:doctors!doctor_id(full_name_ar)"
    )
    .order("created_at", { ascending: false })
    .limit(limit);

  return (data ?? []).map((row) => ({
    id: row.id as string,
    sessionId: row.session_id as string,
    patientName: relationOneName(
      row.patient as { full_name_ar: string } | { full_name_ar: string }[] | null
    ),
    doctorName: relationOneName(
      row.doctor as { full_name_ar: string } | { full_name_ar: string }[] | null
    ),
    amount: Number(row.amount ?? 0),
    reason: String(row.reason ?? ""),
    createdAt: String(row.created_at ?? ""),
  }));
}

/** Sum of refund amounts in a date range (inclusive) */
export async function fetchTotalRefundsAmount(
  supabase: SupabaseClient,
  opts: { clinicId: string; from?: string; to?: string }
): Promise<number> {
  let query = supabase
    .from("session_refunds")
    .select("amount")
    .eq("clinic_id", opts.clinicId);

  if (opts.from) query = query.gte("created_at", `${opts.from}T00:00:00`);
  if (opts.to) query = query.lte("created_at", `${opts.to}T23:59:59.999`);

  const { data } = await query;
  return (data ?? []).reduce((s, r) => s + Number(r.amount ?? 0), 0);
}

export async function fetchRefundsForReport(
  supabase: SupabaseClient,
  from: string,
  to: string,
  clinicId?: string
): Promise<RefundReportRow[]> {
  if (!clinicId) return [];

  const { data } = await supabase
    .from("session_refunds")
    .select(
      "id, amount, reason, created_at, patient:patients!patient_id(full_name_ar), doctor:doctors!doctor_id(full_name_ar)"
    )
    .eq("clinic_id", clinicId)
    .gte("created_at", `${from}T00:00:00`)
    .lte("created_at", `${to}T23:59:59.999`)
    .order("created_at", { ascending: false });

  return (data ?? []).map((row) => {
    const patient = row.patient as
      | { full_name_ar: string }
      | { full_name_ar: string }[]
      | null;
    const doctor = row.doctor as
      | { full_name_ar: string }
      | { full_name_ar: string }[]
      | null;
    const patientName = Array.isArray(patient)
      ? patient[0]?.full_name_ar
      : patient?.full_name_ar;
    const doctorName = Array.isArray(doctor)
      ? doctor[0]?.full_name_ar
      : doctor?.full_name_ar;

    return {
      id: row.id as string,
      patientName: patientName?.trim() || "—",
      amount: Number(row.amount ?? 0),
      doctorName: doctorName?.trim() || "—",
      date: String(row.created_at ?? ""),
      reason: String(row.reason ?? ""),
    };
  });
}
