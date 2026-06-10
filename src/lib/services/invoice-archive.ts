import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildInvoiceNumber,
  type SessionInvoiceData,
} from "@/lib/invoices/session-invoice";
import { doctorShareFromExpense } from "@/lib/services/assistant-payroll";
import { opName } from "@/types";

export type InvoiceLifecycleStatus = "pending" | "archived";
export type InvoiceRecordStatus = "draft" | "finalized";

export interface InvoiceHistoryRow {
  id: string;
  clinic_id: string;
  doctor_id: string | null;
  patient_id: string | null;
  operation_id: string | null;
  invoice_id: string | null;
  invoice_number: string;
  patient_name_ar: string;
  doctor_name_ar: string;
  procedure_label: string;
  treatment_name: string;
  total_amount: number;
  paid_amount: number;
  remaining_amount: number;
  doctor_share: number;
  clinic_share: number;
  invoice_date: string;
  finalized_at: string;
  finalized_by: string | null;
  record_kind?: "session_invoice" | "doctor_expense";
  doctor_expense_id?: string | null;
  snapshot_json: SessionInvoiceData | Record<string, unknown>;
}

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

/** إنشاء أو إرجاع مسودة فاتورة مرتبطة بجلسة */
export async function ensureDraftInvoiceForOperation(
  admin: SupabaseClient,
  input: {
    clinicId: string;
    operationId: string;
    createdBy: string;
    snapshot?: Partial<SessionInvoiceData>;
  }
): Promise<{ ok: true; invoiceId: string } | { ok: false; error: string }> {
  const { data: op, error: opErr } = await admin
    .from("patient_operations")
    .select(
      "id, clinic_id, patient_id, doctor_id, total_amount, paid_amount, operation_date, operation_name_ar, operation_type, doctor_share_amount, clinic_share_amount, invoice_status"
    )
    .eq("id", input.operationId)
    .maybeSingle();

  if (opErr || !op) {
    return { ok: false, error: "الجلسة غير موجودة" };
  }
  if (op.clinic_id !== input.clinicId) {
    return { ok: false, error: "غير مصرح" };
  }
  if (op.invoice_status === "archived") {
    return { ok: false, error: "الفاتورة مؤرشفة مسبقاً" };
  }

  const { data: existing } = await admin
    .from("invoices")
    .select("id, status")
    .eq("operation_id", input.operationId)
    .maybeSingle();

  if (existing?.id) {
    return { ok: true, invoiceId: existing.id };
  }

  const total = roundMoney(
    Number(input.snapshot?.caseTotalAmount ?? op.total_amount ?? 0)
  );
  const paid = roundMoney(
    Number(input.snapshot?.paidThisSession ?? op.paid_amount ?? 0)
  );
  const invoiceNumber =
    input.snapshot?.invoiceNumber ?? buildInvoiceNumber(input.operationId);
  const invoiceDate =
    input.snapshot?.sessionDate ??
    (op.operation_date as string) ??
    new Date().toISOString().slice(0, 10);

  const { data: created, error: insertErr } = await admin
    .from("invoices")
    .insert({
      clinic_id: input.clinicId,
      patient_id: op.patient_id,
      doctor_id: op.doctor_id,
      operation_id: input.operationId,
      total_amount: total > 0 ? total : paid,
      paid_amount: paid,
      invoice_date: invoiceDate,
      invoice_number: invoiceNumber,
      status: "draft",
      notes: input.snapshot?.notes ?? null,
      created_by: input.createdBy,
    })
    .select("id")
    .single();

  if (insertErr || !created?.id) {
    return {
      ok: false,
      error: insertErr?.message ?? "تعذر إنشاء مسودة الفاتورة",
    };
  }

  return { ok: true, invoiceId: created.id };
}

/** اعتماد نهائي — أرشفة في invoices_history وإخفاء من العمليات النشطة */
export async function finalizeInvoiceToHistory(
  admin: SupabaseClient,
  input: {
    clinicId: string;
    operationId: string;
    finalizedBy: string;
    snapshot: SessionInvoiceData;
    invoiceId?: string | null;
  }
): Promise<
  | { ok: true; historyId: string; alreadyArchived?: boolean }
  | { ok: false; error: string }
> {
  const operationId = input.operationId;

  const { data: existingHistory } = await admin
    .from("invoices_history")
    .select("id")
    .eq("operation_id", operationId)
    .maybeSingle();

  if (existingHistory?.id) {
    await admin
      .from("patient_operations")
      .update({ invoice_status: "archived" })
      .eq("id", operationId);
    return {
      ok: true,
      historyId: existingHistory.id,
      alreadyArchived: true,
    };
  }

  const { data: op, error: opErr } = await admin
    .from("patient_operations")
    .select(
      "id, clinic_id, patient_id, doctor_id, total_amount, paid_amount, operation_date, doctor_share_amount, clinic_share_amount, invoice_status"
    )
    .eq("id", operationId)
    .maybeSingle();

  if (opErr || !op) {
    return { ok: false, error: "الجلسة غير موجودة" };
  }
  if (op.clinic_id !== input.clinicId) {
    return { ok: false, error: "غير مصرح" };
  }

  let invoiceId = input.invoiceId ?? null;
  if (!invoiceId) {
    const draft = await ensureDraftInvoiceForOperation(admin, {
      clinicId: input.clinicId,
      operationId,
      createdBy: input.finalizedBy,
      snapshot: input.snapshot,
    });
    if (!draft.ok) return draft;
    invoiceId = draft.invoiceId;
  }

  const paid = roundMoney(input.snapshot.paidThisSession);
  const total = roundMoney(
    input.snapshot.caseTotalAmount > 0
      ? input.snapshot.caseTotalAmount
      : paid
  );
  const remaining = roundMoney(input.snapshot.remainingBalance);
  const doctorShare = roundMoney(Number(op.doctor_share_amount ?? 0));
  const clinicShare = roundMoney(Number(op.clinic_share_amount ?? 0));
  const invoiceDate =
    input.snapshot.sessionDate ??
    (op.operation_date as string) ??
    new Date().toISOString().slice(0, 10);

  const { data: history, error: histErr } = await admin
    .from("invoices_history")
    .insert({
      clinic_id: input.clinicId,
      doctor_id: op.doctor_id,
      patient_id: op.patient_id,
      operation_id: operationId,
      invoice_id: invoiceId,
      invoice_number: input.snapshot.invoiceNumber,
      patient_name_ar: input.snapshot.patientName,
      doctor_name_ar: input.snapshot.doctorName,
      procedure_label: input.snapshot.procedureLabel,
      treatment_name: input.snapshot.treatmentName,
      total_amount: total,
      paid_amount: paid,
      remaining_amount: remaining,
      doctor_share: doctorShare,
      clinic_share: clinicShare,
      invoice_date: invoiceDate,
      finalized_at: new Date().toISOString(),
      finalized_by: input.finalizedBy,
      record_kind: "session_invoice",
      snapshot_json: input.snapshot,
    })
    .select("id")
    .single();

  if (histErr || !history?.id) {
    return {
      ok: false,
      error: histErr?.message ?? "تعذر أرشفة الفاتورة",
    };
  }

  const now = new Date().toISOString();

  await Promise.all([
    admin
      .from("invoices")
      .update({
        status: "finalized",
        finalized_at: now,
        finalized_by: input.finalizedBy,
        invoice_number: input.snapshot.invoiceNumber,
        total_amount: total,
        paid_amount: paid,
      })
      .eq("id", invoiceId),
    admin
      .from("patient_operations")
      .update({ invoice_status: "archived" })
      .eq("id", operationId),
  ]);

  return { ok: true, historyId: history.id };
}

/** تسمية الإجراء من الجلسة */
export function procedureLabelFromOperation(row: {
  operation_name_ar?: string | null;
  operation_type?: string | null;
}): string {
  return opName(row as Parameters<typeof opName>[0]);
}

function buildDoctorExpenseInvoiceNumber(
  expenseId: string,
  expenseDate: string
): string {
  const short = expenseId.replace(/-/g, "").slice(0, 8).toUpperCase();
  const ymd = expenseDate.replace(/-/g, "");
  return `EXP-${ymd}-${short}`;
}

/** أرشفة فاتورة صرف (doctor_expenses) → السجل التاريخي */
export async function archiveDoctorExpenseToHistory(
  admin: SupabaseClient,
  input: {
    clinicId: string;
    expenseId: string;
    finalizedBy: string;
  }
): Promise<
  | { ok: true; historyId: string; skipped?: boolean }
  | { ok: false; error: string }
> {
  const { data: existing } = await admin
    .from("invoices_history")
    .select("id")
    .eq("doctor_expense_id", input.expenseId)
    .maybeSingle();

  if (existing?.id) {
    await admin
      .from("doctor_expenses")
      .update({ archived_to_history: true })
      .eq("id", input.expenseId);
    return { ok: true, historyId: existing.id, skipped: true };
  }

  const { data: expense, error: expErr } = await admin
    .from("doctor_expenses")
    .select(
      "id, clinic_id, doctor_id, amount, percentage_split, description_ar, expense_date, created_by, invoice_file_name"
    )
    .eq("id", input.expenseId)
    .maybeSingle();

  if (expErr || !expense) {
    return { ok: false, error: "فاتورة الصرف غير موجودة" };
  }
  if (expense.clinic_id !== input.clinicId) {
    return { ok: false, error: "غير مصرح" };
  }

  const { data: doctor } = await admin
    .from("doctors")
    .select("full_name_ar")
    .eq("id", expense.doctor_id)
    .maybeSingle();

  const amount = roundMoney(Number(expense.amount ?? 0));
  const split = Number(expense.percentage_split ?? 50);
  const doctorShare = doctorShareFromExpense(amount, split);
  const clinicShare = roundMoney(amount - doctorShare);
  const expenseDate = String(expense.expense_date ?? new Date().toISOString().slice(0, 10));
  const label =
    String(expense.description_ar ?? "").trim() || "صرفية عيادة";

  const snapshot = {
    kind: "doctor_expense",
    doctor_expense_id: expense.id,
    amount,
    percentage_split: split,
    description_ar: expense.description_ar,
    invoice_file_name: expense.invoice_file_name,
  };

  const { data: history, error: histErr } = await admin
    .from("invoices_history")
    .insert({
      clinic_id: input.clinicId,
      doctor_id: expense.doctor_id,
      doctor_expense_id: expense.id,
      record_kind: "doctor_expense",
      invoice_number: buildDoctorExpenseInvoiceNumber(expense.id, expenseDate),
      patient_name_ar: "",
      doctor_name_ar: String(doctor?.full_name_ar ?? ""),
      procedure_label: label,
      treatment_name: "صرفية",
      total_amount: amount,
      paid_amount: amount,
      remaining_amount: 0,
      doctor_share: doctorShare,
      clinic_share: clinicShare,
      invoice_date: expenseDate,
      finalized_at: new Date().toISOString(),
      finalized_by: input.finalizedBy,
      snapshot_json: snapshot,
    })
    .select("id")
    .single();

  if (histErr || !history?.id) {
    return {
      ok: false,
      error: histErr?.message ?? "تعذر نقل فاتورة الصرف للسجل التاريخي",
    };
  }

  await admin
    .from("doctor_expenses")
    .update({ archived_to_history: true })
    .eq("id", expense.id);

  return { ok: true, historyId: history.id };
}

/** مزامنة الصرفيات القديمة التي لم تُؤرشف بعد */
export async function syncDoctorExpensesToHistory(
  admin: SupabaseClient,
  clinicId: string,
  finalizedBy: string
): Promise<void> {
  const { data: pending } = await admin
    .from("doctor_expenses")
    .select("id")
    .eq("clinic_id", clinicId)
    .eq("archived_to_history", false)
    .limit(100);

  for (const row of pending ?? []) {
    await archiveDoctorExpenseToHistory(admin, {
      clinicId,
      expenseId: row.id as string,
      finalizedBy,
    });
  }
}
