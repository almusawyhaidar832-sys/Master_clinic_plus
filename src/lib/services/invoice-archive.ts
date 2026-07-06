import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildInvoiceNumber,
  type SessionInvoiceData,
} from "@/lib/invoices/session-invoice";
import {
  computeLabCostSplit,
  parseMaterialsCost,
} from "@/lib/invoices/lab-session-details";
import { doctorShareFromExpense } from "@/lib/services/assistant-payroll";
import { doctorPaymentPct } from "@/lib/services/patient-financial-plan";
import {
  calcOperationEarned,
} from "@/lib/services/doctor-wallet";
import { isSalaryDoctor } from "@/lib/services/doctor-payment";
import type { Doctor } from "@/types";
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

function isMissingColumnError(
  msg: string | undefined,
  column: string
): boolean {
  if (!msg) return false;
  const m = msg.toLowerCase();
  const col = column.toLowerCase();
  return (
    m.includes(col) &&
    (m.includes("column") ||
      m.includes("schema") ||
      m.includes("does not exist") ||
      m.includes("could not find"))
  );
}

type ArchiveOperationRow = {
  id: string;
  clinic_id: string;
  patient_id: string | null;
  doctor_id: string | null;
  total_amount?: number | string | null;
  paid_amount?: number | string | null;
  operation_date?: string | null;
  doctor_share_amount?: number | string | null;
  clinic_share_amount?: number | string | null;
  review_fee_amount?: number | string | null;
  is_review_statement?: boolean | null;
  invoice_status?: string | null;
};

const OP_SELECT_ARCHIVE =
  "id, clinic_id, patient_id, doctor_id, total_amount, paid_amount, operation_date, operation_name_ar, doctor_share_amount, clinic_share_amount, review_fee_amount, is_review_statement, invoice_status";

const OP_SELECT_ARCHIVE_BASE =
  "id, clinic_id, patient_id, doctor_id, total_amount, paid_amount, operation_date, operation_name_ar, doctor_share_amount, clinic_share_amount, review_fee_amount, is_review_statement";

async function fetchOperationForArchive(
  admin: SupabaseClient,
  operationId: string
): Promise<{ op: ArchiveOperationRow | null; error?: string }> {
  let res = await admin
    .from("patient_operations")
    .select(OP_SELECT_ARCHIVE)
    .eq("id", operationId)
    .maybeSingle();

  if (res.error?.message?.includes("invoice_status")) {
    res = await admin
      .from("patient_operations")
      .select(OP_SELECT_ARCHIVE_BASE)
      .eq("id", operationId)
      .maybeSingle();
  }

  if (res.error) return { op: null, error: res.error.message };
  return { op: res.data as ArchiveOperationRow | null };
}

async function loadPatientNameAr(
  admin: SupabaseClient,
  clinicId: string,
  patientId: string | null
): Promise<string> {
  if (!patientId) return "";
  const { data } = await admin
    .from("patients")
    .select("full_name_ar")
    .eq("clinic_id", clinicId)
    .eq("id", patientId)
    .maybeSingle();
  return String(data?.full_name_ar ?? "").trim();
}

async function loadDoctorNameAr(
  admin: SupabaseClient,
  doctorId: string | null
): Promise<string> {
  if (!doctorId) return "";
  const { data } = await admin
    .from("doctors")
    .select("full_name_ar")
    .eq("id", doctorId)
    .maybeSingle();
  return String(data?.full_name_ar ?? "").trim();
}

async function enrichSnapshotWithLabSplit(
  admin: SupabaseClient,
  snapshot: SessionInvoiceData,
  doctorId: string | null
): Promise<SessionInvoiceData> {
  const materialsCost = parseMaterialsCost(snapshot.materialsCost);
  if (materialsCost <= 0 || !doctorId) return snapshot;

  let materialsSharePct = Number(snapshot.materialsSharePct ?? NaN);
  if (!Number.isFinite(materialsSharePct)) {
    const { data: doctor } = await admin
      .from("doctors")
      .select("materials_share")
      .eq("id", doctorId)
      .maybeSingle();
    materialsSharePct = Number(doctor?.materials_share ?? 50);
  }

  const labSplit = computeLabCostSplit(materialsCost, materialsSharePct);
  if (!labSplit) return snapshot;

  return {
    ...snapshot,
    materialsCost: labSplit.materialsCost,
    materialsSharePct: labSplit.materialsSharePct,
    labDoctorShare: labSplit.doctorShare,
    labClinicShare: labSplit.clinicShare,
  };
}

async function resolveDoctorShareForArchive(
  admin: SupabaseClient,
  doctorId: string | null,
  op: Pick<
    ArchiveOperationRow,
    | "doctor_share_amount"
    | "clinic_share_amount"
    | "paid_amount"
    | "review_fee_amount"
    | "is_review_statement"
  >,
  paid: number
): Promise<{ doctorShare: number; clinicShare: number }> {
  const storedDoc = roundMoney(Number(op.doctor_share_amount ?? 0));
  const storedClinic = roundMoney(Number(op.clinic_share_amount ?? 0));
  const hasReviewFee =
    Boolean(op.is_review_statement) ||
    Number(op.review_fee_amount ?? 0) > 0;

  if ((storedDoc !== 0 || storedClinic !== 0) && !hasReviewFee) {
    return {
      doctorShare: storedDoc,
      clinicShare:
        storedClinic > 0 ? storedClinic : roundMoney(Math.max(paid - storedDoc, 0)),
    };
  }

  if (!doctorId || paid <= 0) {
    return { doctorShare: 0, clinicShare: roundMoney(paid) };
  }

  const { data: doctorRaw } = await admin
    .from("doctors")
    .select(
      "id, percentage, payment_type, financial_agreement, materials_share"
    )
    .eq("id", doctorId)
    .maybeSingle();

  const doctor = (doctorRaw as Doctor | null) ?? null;
  const doctorPct = doctorPaymentPct(doctor);
  const salaryDoctor = isSalaryDoctor(doctor ?? {});

  const doctorShare = calcOperationEarned(
    {
      doctor_share_amount: op.doctor_share_amount,
      clinic_share_amount: op.clinic_share_amount,
      paid_amount: paid,
      review_fee_amount: op.review_fee_amount,
      is_review_statement: op.is_review_statement,
    },
    doctorPct,
    salaryDoctor,
    doctor
  );

  return {
    doctorShare,
    clinicShare: roundMoney(Math.max(paid - doctorShare, 0)),
  };
}

async function markOperationArchived(
  admin: SupabaseClient,
  operationId: string
): Promise<void> {
  const { error } = await admin
    .from("patient_operations")
    .update({ invoice_status: "archived" })
    .eq("id", operationId);

  if (error?.message?.includes("invoice_status")) {
    return;
  }
}

async function insertSessionHistoryRow(
  admin: SupabaseClient,
  payload: Record<string, unknown>
): Promise<{ id: string } | { error: string }> {
  const withKind = { ...payload, record_kind: "session_invoice" };
  let res = await admin
    .from("invoices_history")
    .insert(withKind)
    .select("id")
    .single();

  if (res.error && isMissingColumnError(res.error.message, "record_kind")) {
    const { record_kind: _rk, ...withoutKind } = withKind;
    res = await admin
      .from("invoices_history")
      .insert(withoutKind)
      .select("id")
      .single();
  }

  if (res.error || !res.data?.id) {
    const msg = res.error?.message ?? "";
    if (
      msg.includes("invoices_history") &&
      (msg.includes("does not exist") || msg.includes("schema cache"))
    ) {
      return {
        error:
          "جدول السجل التاريخي غير موجود. شغّل سكربت 25-invoices-history.sql على Supabase",
      };
    }
    return { error: msg || "تعذر أرشفة الفاتورة في السجل التاريخي" };
  }

  return { id: res.data.id as string };
}

async function finalizeInvoiceRecord(
  admin: SupabaseClient,
  invoiceId: string,
  input: {
    finalizedBy: string;
    invoiceNumber: string;
    total: number;
    paid: number;
  }
): Promise<string | null> {
  const now = new Date().toISOString();
  const { error } = await admin
    .from("invoices")
    .update({
      status: "finalized",
      finalized_at: now,
      finalized_by: input.finalizedBy,
      invoice_number: input.invoiceNumber,
      total_amount: input.total,
      paid_amount: input.paid,
    })
    .eq("id", invoiceId);

  return error?.message ?? null;
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
  const { op, error: opErr } = await fetchOperationForArchive(
    admin,
    input.operationId
  );

  if (opErr || !op) {
    return { ok: false, error: opErr ?? "الجلسة غير موجودة" };
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
    .select("id, doctor_id, paid_amount")
    .eq("operation_id", operationId)
    .maybeSingle();

  if (existingHistory?.id) {
    const doctorId =
      input.snapshot.doctorId ??
      (existingHistory.doctor_id as string | null) ??
      null;

    if (doctorId && !existingHistory.doctor_id) {
      await admin
        .from("invoices_history")
        .update({ doctor_id: doctorId })
        .eq("id", existingHistory.id);
    }

    await markOperationArchived(admin, operationId);

    if (input.invoiceId) {
      const paid = roundMoney(
        Math.max(
          Number(input.snapshot.paidThisSession ?? 0),
          Number(existingHistory.paid_amount ?? 0)
        )
      );
      const total = roundMoney(
        input.snapshot.caseTotalAmount > 0
          ? input.snapshot.caseTotalAmount
          : paid
      );
      await finalizeInvoiceRecord(admin, input.invoiceId, {
        finalizedBy: input.finalizedBy,
        invoiceNumber: input.snapshot.invoiceNumber,
        total,
        paid,
      });
    }

    return {
      ok: true,
      historyId: existingHistory.id,
      alreadyArchived: true,
    };
  }

  const { op, error: opErr } = await fetchOperationForArchive(
    admin,
    operationId
  );

  if (opErr || !op) {
    return { ok: false, error: opErr ?? "الجلسة غير موجودة" };
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

  const doctorId = op.doctor_id ?? input.snapshot.doctorId ?? null;
  const paid = roundMoney(
    Math.max(
      Number(input.snapshot.paidThisSession ?? 0),
      Number(op.paid_amount ?? 0)
    )
  );
  const total = roundMoney(
    input.snapshot.caseTotalAmount > 0
      ? input.snapshot.caseTotalAmount
      : Number(op.total_amount ?? 0) > 0
        ? Number(op.total_amount)
        : paid
  );
  const remaining = roundMoney(
    input.snapshot.remainingBalance > 0
      ? input.snapshot.remainingBalance
      : Math.max(total - paid, 0)
  );
  const { doctorShare, clinicShare } = await resolveDoctorShareForArchive(
    admin,
    doctorId,
    op,
    paid
  );
  const invoiceDate =
    input.snapshot.sessionDate ??
    (op.operation_date as string) ??
    new Date().toISOString().slice(0, 10);

  const patientName =
    String(input.snapshot.patientName ?? "").trim() ||
    (await loadPatientNameAr(admin, input.clinicId, op.patient_id));
  const doctorName =
    String(input.snapshot.doctorName ?? "").trim() ||
    (await loadDoctorNameAr(admin, doctorId));

  const snapshotForHistory = await enrichSnapshotWithLabSplit(
    admin,
    { ...input.snapshot, doctorId: doctorId ?? undefined, paidThisSession: paid },
    doctorId
  );

  const historyResult = await insertSessionHistoryRow(admin, {
    clinic_id: input.clinicId,
    doctor_id: doctorId,
    patient_id: op.patient_id,
    operation_id: operationId,
    invoice_id: invoiceId,
    invoice_number: input.snapshot.invoiceNumber,
    patient_name_ar: patientName || "مراجع",
    doctor_name_ar: doctorName,
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
    snapshot_json: snapshotForHistory,
  });

  if ("error" in historyResult) {
    return { ok: false, error: historyResult.error };
  }

  const invoiceUpdateErr = await finalizeInvoiceRecord(admin, invoiceId, {
    finalizedBy: input.finalizedBy,
    invoiceNumber: input.snapshot.invoiceNumber,
    total,
    paid,
  });

  await markOperationArchived(admin, operationId);

  if (invoiceUpdateErr && !invoiceUpdateErr.includes("finalized_at")) {
    return {
      ok: false,
      error: `تم الترحيل للسجل التاريخي لكن تعذر تحديث حالة الفاتورة: ${invoiceUpdateErr}`,
    };
  }

  return { ok: true, historyId: historyResult.id };
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
      "id, clinic_id, doctor_id, amount, percentage_split, description_ar, expense_date, created_by, invoice_file_name, invoice_storage_path, invoice_mime_type"
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
    invoice_storage_path: expense.invoice_storage_path,
    invoice_mime_type: expense.invoice_mime_type,
  };

  const expensePayload = {
    clinic_id: input.clinicId,
    doctor_id: expense.doctor_id,
    doctor_expense_id: expense.id,
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
    record_kind: "doctor_expense",
  };

  let histRes = await admin
    .from("invoices_history")
    .insert(expensePayload)
    .select("id")
    .single();

  if (histRes.error && isMissingColumnError(histRes.error.message, "record_kind")) {
    const { record_kind: _rk, doctor_expense_id: _de, ...fallback } =
      expensePayload;
    histRes = await admin
      .from("invoices_history")
      .insert(fallback)
      .select("id")
      .single();
  }

  if (histRes.error || !histRes.data?.id) {
    return {
      ok: false,
      error: histRes.error?.message ?? "تعذر نقل فاتورة الصرف للسجل التاريخي",
    };
  }

  const history = histRes.data;

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
