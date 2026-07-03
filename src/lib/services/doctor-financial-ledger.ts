import type { SupabaseClient } from "@supabase/supabase-js";
import { buildInvoiceNumber } from "@/lib/invoices/session-invoice";
import {
  labDetailsFromOperation,
  labDetailsFromSnapshot,
} from "@/lib/invoices/lab-session-details";
import { isSalaryDoctor } from "@/lib/services/doctor-payment";
import {
  calcOperationEarned,
  filterWithdrawalsInPeriod,
  withdrawalEffectiveDate,
} from "@/lib/services/doctor-wallet";
import {
  withdrawalSourceLabel,
  withdrawalStatusLabel,
} from "@/lib/withdrawals/display";
import { SALARY_ENTRY_TYPE_LABELS } from "@/lib/services/salary-entry-display";
import type { SalaryEntryType } from "@/types";
import type { InvoiceHistoryRow } from "@/lib/services/invoice-archive";
import { fetchInvoiceHistory } from "@/lib/services/invoice-history-query";
import { doctorExpenseHasAttachmentHint } from "@/lib/services/doctor-expense-invoice-file";
import { opName, type PatientOperation } from "@/types";
import type { WithdrawalStatus } from "@/types";

export interface DoctorLedgerDateFilters {
  dateFrom?: string | null;
  dateTo?: string | null;
  limit?: number;
  offset?: number;
}

export interface DoctorLedgerInvoiceRow {
  id: string;
  invoice_number: string;
  invoice_date: string;
  record_kind: "session_invoice" | "doctor_expense";
  patient_name_ar: string;
  procedure_label: string;
  treatment_name: string;
  paid_amount: number;
  doctor_share: number;
  total_amount: number;
  materials_cost: number;
  lab_notes: string | null;
  doctor_expense_id?: string | null;
  invoice_file_name?: string | null;
  has_invoice_attachment?: boolean;
}

export interface DoctorLedgerPatientRow {
  id: string;
  patient_id: string | null;
  patient_name_ar: string;
  paid_amount: number;
  doctor_share: number;
  payment_date: string;
  procedure_label: string;
  is_first_payment: boolean;
  materials_cost: number;
  lab_notes: string | null;
}

export type DoctorLedgerOperationKind =
  | "withdrawal"
  | "salary_payout"
  | "salary_adjustment"
  | "expense_deduction"
  | "payroll_deduction";

export interface DoctorLedgerOperationRow {
  id: string;
  kind: DoctorLedgerOperationKind;
  label: string;
  amount: number;
  operation_date: string;
  status?: WithdrawalStatus | string;
}

export interface DoctorFinancialReportData {
  doctor_name_ar: string;
  date_from: string | null;
  date_to: string | null;
  total_earnings: number;
  available_balance: number;
  total_collected_from_patients: number;
  total_doctor_share_from_sessions: number;
  total_withdrawn: number;
  total_salary_paid: number;
  total_expense_deductions: number;
  total_payroll_deductions: number;
  net_calc_hint: number;
  invoices: DoctorLedgerInvoiceRow[];
  patient_payments: DoctorLedgerPatientRow[];
  withdrawals: DoctorLedgerOperationRow[];
  salary_payouts: DoctorLedgerOperationRow[];
  salary_adjustments: DoctorLedgerOperationRow[];
  expense_deductions: DoctorLedgerOperationRow[];
  payroll_deductions: DoctorLedgerOperationRow[];
}

const WITHDRAWAL_STATUS_AR: Record<string, string> = {
  pending: "معلّق",
  approved: "موافق",
  paid: "مدفوع",
  rejected: "مرفوض",
};

interface SessionPaymentRow {
  id: string;
  operation_id: string | null;
  patient_id: string | null;
  patient_name_ar: string;
  paid_amount: number;
  doctor_share: number;
  payment_date: string;
  sort_ts: string;
  procedure_label: string;
  treatment_name: string;
  total_amount: number;
  invoice_number: string;
  materials_cost: number;
  lab_notes: string | null;
}

function inDateRange(
  date: string,
  dateFrom?: string | null,
  dateTo?: string | null
): boolean {
  if (dateFrom && date < dateFrom) return false;
  if (dateTo && date > dateTo) return false;
  return true;
}

/** تطبيع عربي للبحث */
export function normalizeArabicText(value: string): string {
  return value
    .trim()
    .replace(/\u0640/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .toLowerCase();
}

export function matchesPatientSearch(name: string, search: string): boolean {
  const q = normalizeArabicText(search);
  if (!q) return true;
  return normalizeArabicText(name).includes(q);
}

export function matchesPatientRowSearch(
  row: Pick<DoctorLedgerPatientRow, "patient_name_ar" | "procedure_label">,
  search: string
): boolean {
  const q = normalizeArabicText(search);
  if (!q) return true;
  const name = normalizeArabicText(row.patient_name_ar);
  const procedure = normalizeArabicText(row.procedure_label);
  return name.includes(q) || procedure.includes(q);
}

const PATIENT_SUGGEST_MIN_CHARS = 2;

/** اقتراح أسماء مراجعين للبحث — بعد حرفين أو أكثر */
export function suggestPatientNames(
  rows: Pick<DoctorLedgerPatientRow, "patient_name_ar">[],
  search: string,
  limit = 8
): string[] {
  const q = normalizeArabicText(search.trim());
  if (q.length < PATIENT_SUGGEST_MIN_CHARS) return [];

  const seen = new Map<string, string>();
  for (const row of rows) {
    const display = row.patient_name_ar.trim();
    if (!display || display === "مراجع") continue;
    if (!normalizeArabicText(display).includes(q)) continue;
    const key = normalizeArabicText(display);
    if (!seen.has(key)) seen.set(key, display);
  }

  return [...seen.values()]
    .sort((a, b) => a.localeCompare(b, "ar"))
    .slice(0, limit);
}

async function loadPatientNames(
  admin: SupabaseClient,
  clinicId: string,
  patientIds: string[]
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const ids = [...new Set(patientIds.filter(Boolean))];
  if (!ids.length) return map;

  const { data } = await admin
    .from("patients")
    .select("id, full_name_ar")
    .eq("clinic_id", clinicId)
    .in("id", ids);

  for (const p of data ?? []) {
    map.set(p.id as string, String(p.full_name_ar ?? "").trim() || "مراجع");
  }
  return map;
}

async function loadDoctorPaymentMeta(
  admin: SupabaseClient,
  doctorId: string
): Promise<{ pct: number; salaryDoctor: boolean }> {
  const { data } = await admin
    .from("doctors")
    .select("percentage, payment_type, financial_agreement")
    .eq("id", doctorId)
    .maybeSingle();

  return {
    pct: Number(data?.percentage ?? 50) / 100,
    salaryDoctor: isSalaryDoctor(data ?? {}),
  };
}

type OperationEarningSource = {
  doctor_share_amount?: number | string | null;
  paid_amount?: number | string | null;
  patient_treatment_cases?:
    | { doctor_share_total?: number; final_price?: number }
    | { doctor_share_total?: number; final_price?: number }[]
    | null;
};

const OPS_SELECT_WITH_CASE =
  "id, patient_id, paid_amount, doctor_share_amount, operation_date, created_at, operation_name_ar, operation_type, total_amount, session_kind, treatment_case_id, materials_cost, lab_notes, patient_treatment_cases(doctor_share_total, final_price)";

const OPS_SELECT_BASE =
  "id, patient_id, paid_amount, doctor_share_amount, operation_date, created_at, operation_name_ar, operation_type, total_amount, session_kind, materials_cost, lab_notes";

const OPS_SELECT_WITH_CASE_NO_LAB =
  "id, patient_id, paid_amount, doctor_share_amount, operation_date, created_at, operation_name_ar, operation_type, total_amount, session_kind, treatment_case_id, patient_treatment_cases(doctor_share_total, final_price)";

const OPS_SELECT_BASE_NO_LAB =
  "id, patient_id, paid_amount, doctor_share_amount, operation_date, created_at, operation_name_ar, operation_type, total_amount, session_kind";

const OPS_SELECT_MINIMAL =
  "id, patient_id, paid_amount, doctor_share_amount, operation_date, created_at, operation_name_ar, total_amount";

async function fetchDoctorPaidOperations(
  admin: SupabaseClient,
  clinicId: string,
  doctorId: string,
  filters: DoctorLedgerDateFilters
) {
  let query = admin
    .from("patient_operations")
    .select(OPS_SELECT_WITH_CASE)
    .eq("clinic_id", clinicId)
    .eq("doctor_id", doctorId)
    .order("created_at", { ascending: false })
    .limit(500);

  if (filters.dateFrom) {
    query = query.gte("operation_date", filters.dateFrom);
  }
  if (filters.dateTo) {
    query = query.lte("operation_date", filters.dateTo);
  }

  let res = await query;

  if (
    res.error?.message?.includes("patient_treatment_cases") ||
    res.error?.message?.includes("treatment_case_id") ||
    res.error?.message?.includes("session_kind")
  ) {
    let fallback = admin
      .from("patient_operations")
      .select(OPS_SELECT_BASE)
      .eq("clinic_id", clinicId)
      .eq("doctor_id", doctorId)
      .order("created_at", { ascending: false })
      .limit(500);

    if (filters.dateFrom) {
      fallback = fallback.gte("operation_date", filters.dateFrom);
    }
    if (filters.dateTo) {
      fallback = fallback.lte("operation_date", filters.dateTo);
    }

    res = (await fallback) as typeof res;
  }

  if (
    res.error?.message?.includes("materials_cost") ||
    res.error?.message?.includes("lab_notes")
  ) {
    let withoutLab = admin
      .from("patient_operations")
      .select(OPS_SELECT_WITH_CASE_NO_LAB)
      .eq("clinic_id", clinicId)
      .eq("doctor_id", doctorId)
      .order("created_at", { ascending: false })
      .limit(500);

    if (filters.dateFrom) {
      withoutLab = withoutLab.gte("operation_date", filters.dateFrom);
    }
    if (filters.dateTo) {
      withoutLab = withoutLab.lte("operation_date", filters.dateTo);
    }

    res = (await withoutLab) as typeof res;

    if (
      res.error?.message?.includes("patient_treatment_cases") ||
      res.error?.message?.includes("treatment_case_id") ||
      res.error?.message?.includes("session_kind")
    ) {
      let baseNoLab = admin
        .from("patient_operations")
        .select(OPS_SELECT_BASE_NO_LAB)
        .eq("clinic_id", clinicId)
        .eq("doctor_id", doctorId)
        .order("created_at", { ascending: false })
        .limit(500);

      if (filters.dateFrom) {
        baseNoLab = baseNoLab.gte("operation_date", filters.dateFrom);
      }
      if (filters.dateTo) {
        baseNoLab = baseNoLab.lte("operation_date", filters.dateTo);
      }

      res = (await baseNoLab) as typeof res;
    }
  }

  if (
    res.error?.message?.includes("operation_type") ||
    res.error?.message?.includes("operation_name_ar")
  ) {
    let minimal = admin
      .from("patient_operations")
      .select(OPS_SELECT_MINIMAL)
      .eq("clinic_id", clinicId)
      .eq("doctor_id", doctorId)
      .order("created_at", { ascending: false })
      .limit(500);

    if (filters.dateFrom) {
      minimal = minimal.gte("operation_date", filters.dateFrom);
    }
    if (filters.dateTo) {
      minimal = minimal.lte("operation_date", filters.dateTo);
    }

    res = (await minimal) as typeof res;
  }

  return res;
}

async function loadDoctorHistoryRecords(
  admin: SupabaseClient,
  clinicId: string,
  doctorId: string,
  filters: DoctorLedgerDateFilters
): Promise<InvoiceHistoryRow[]> {
  try {
    const { rows } = await fetchInvoiceHistory(admin, {
      clinicId,
      doctorId,
      dateFrom: filters.dateFrom,
      dateTo: filters.dateTo,
      limit: 500,
    });
    return rows;
  } catch {
    return [];
  }
}

function mapHistoryToInvoiceRow(row: InvoiceHistoryRow): DoctorLedgerInvoiceRow {
  const isExpense =
    row.record_kind === "doctor_expense" || !!row.doctor_expense_id;
  const lab = isExpense
    ? { materialsCost: 0, labNotes: null }
    : labDetailsFromSnapshot(row.snapshot_json);

  return {
    id: row.id,
    invoice_number: row.invoice_number,
    invoice_date: row.invoice_date,
    record_kind: isExpense ? "doctor_expense" : "session_invoice",
    patient_name_ar: isExpense
      ? "صرفية عيادة"
      : String(row.patient_name_ar ?? "").trim() || "مراجع",
    procedure_label: String(row.procedure_label ?? "") || (isExpense ? "صرفية" : "—"),
    treatment_name: String(row.treatment_name ?? ""),
    paid_amount: row.paid_amount,
    doctor_share: row.doctor_share,
    total_amount: row.total_amount,
    materials_cost: lab.materialsCost,
    lab_notes: lab.labNotes,
    doctor_expense_id: row.doctor_expense_id ?? null,
    invoice_file_name:
      (row.snapshot_json as { invoice_file_name?: string | null } | null)
        ?.invoice_file_name ?? null,
    has_invoice_attachment: isExpense
      ? doctorExpenseHasAttachmentHint({
          recordKind: "doctor_expense",
          doctorExpenseId: row.doctor_expense_id,
          snapshot: row.snapshot_json as Record<string, unknown>,
        })
      : false,
  };
}

function historyToSessionPayment(
  row: InvoiceHistoryRow,
  doctorPct: number,
  salaryDoctor: boolean
): SessionPaymentRow | null {
  if (row.record_kind === "doctor_expense" || row.doctor_expense_id) {
    return null;
  }

  const paid = Number(row.paid_amount ?? 0);
  if (paid <= 0) return null;

  const paymentDate =
    String(row.invoice_date ?? row.finalized_at ?? "").slice(0, 10) ||
    new Date().toISOString().slice(0, 10);

  const raw = row as unknown as Record<string, unknown>;
  const doctorShare = resolveHistoryDoctorShare(raw, paid, doctorPct, salaryDoctor);
  const lab = labDetailsFromSnapshot(row.snapshot_json);

  return {
    id: row.id,
    operation_id: row.operation_id,
    patient_id: row.patient_id,
    patient_name_ar: String(row.patient_name_ar ?? "").trim() || "مراجع",
    paid_amount: paid,
    doctor_share: doctorShare,
    payment_date: paymentDate,
    sort_ts: row.finalized_at ?? paymentDate,
    procedure_label: String(row.procedure_label ?? "") || "—",
    treatment_name: String(row.treatment_name ?? ""),
    total_amount: Number(row.total_amount ?? paid),
    invoice_number:
      String(row.invoice_number ?? "") ||
      (row.operation_id ? buildInvoiceNumber(row.operation_id) : ""),
    materials_cost: lab.materialsCost,
    lab_notes: lab.labNotes,
  };
}

function resolveHistoryDoctorShare(
  row: Record<string, unknown>,
  paid: number,
  doctorPct: number,
  salaryDoctor: boolean
): number {
  const stored = Number(row.doctor_share ?? 0);
  if (stored !== 0) return stored;
  if (salaryDoctor || paid <= 0) return 0;

  const snapshot = row.snapshot_json as Record<string, unknown> | null | undefined;
  const snapPaid = Number(snapshot?.paidThisSession ?? 0);
  const snapCaseTotal = Number(snapshot?.caseTotalAmount ?? 0);
  if (snapPaid > 0 && snapCaseTotal > 0 && stored === 0) {
    return Math.round(snapPaid * doctorPct * 100) / 100;
  }

  return Math.round(paid * doctorPct * 100) / 100;
}

function isPaidSessionOperation(
  op: OperationEarningSource & { session_kind?: string | null },
  doctorPct: number,
  salaryDoctor: boolean
): boolean {
  const paid = Number(op.paid_amount ?? 0);
  if (op.session_kind === "discount" && paid <= 0) return false;
  if (paid > 0) return true;
  return calcOperationEarned(op, doctorPct, salaryDoctor) > 0;
}

/** جلسات مدفوعة — سجل تاريخي + patient_operations (بدون صرفيات العيادة) */
async function fetchDoctorSessionPayments(
  admin: SupabaseClient,
  doctorId: string,
  clinicId: string,
  filters: DoctorLedgerDateFilters = {}
): Promise<SessionPaymentRow[]> {
  const seenOps = new Set<string>();
  const rows: SessionPaymentRow[] = [];
  const { pct: doctorPct, salaryDoctor } = await loadDoctorPaymentMeta(
    admin,
    doctorId
  );

  const historyRows = await loadDoctorHistoryRecords(
    admin,
    clinicId,
    doctorId,
    filters
  );

  for (const row of historyRows) {
    const payment = historyToSessionPayment(row, doctorPct, salaryDoctor);
    if (!payment) continue;
    if (payment.operation_id) seenOps.add(payment.operation_id);
    if (!inDateRange(payment.payment_date, filters.dateFrom, filters.dateTo)) {
      continue;
    }
    rows.push(payment);
  }

  const opsRes = await fetchDoctorPaidOperations(
    admin,
    clinicId,
    doctorId,
    filters
  );

  if (!opsRes.error && opsRes.data?.length) {
    const patientMap = await loadPatientNames(
      admin,
      clinicId,
      opsRes.data.map((o) => o.patient_id as string).filter(Boolean)
    );

    for (const raw of opsRes.data) {
      const op = raw as PatientOperation & OperationEarningSource;
      if (seenOps.has(op.id)) continue;
      if (!isPaidSessionOperation(op, doctorPct, salaryDoctor)) continue;

      const paymentDate =
        op.operation_date?.slice(0, 10) ??
        op.created_at?.slice(0, 10) ??
        "";
      if (!paymentDate) continue;

      const paid = Number(op.paid_amount ?? 0);
      const doctorShare = calcOperationEarned(op, doctorPct, salaryDoctor);

      const patientName =
        (patientMap.get(op.patient_id) ??
          (typeof op.patient === "object" &&
          op.patient &&
          "full_name_ar" in op.patient
            ? String(op.patient.full_name_ar ?? "").trim()
            : "")) || "مراجع";
      const lab = labDetailsFromOperation(op);

      rows.push({
        id: `op-${op.id}`,
        operation_id: op.id,
        patient_id: op.patient_id,
        patient_name_ar: patientName,
        paid_amount: paid,
        doctor_share: doctorShare,
        payment_date: paymentDate,
        sort_ts: op.created_at ?? paymentDate,
        procedure_label: opName(op),
        treatment_name: "",
        total_amount: Number(op.total_amount ?? paid),
        invoice_number: buildInvoiceNumber(op.id),
        materials_cost: lab.materialsCost,
        lab_notes: lab.labNotes,
      });
    }
  }

  rows.sort((a, b) => b.sort_ts.localeCompare(a.sort_ts));
  return rows;
}

function patientKey(row: SessionPaymentRow): string {
  return row.patient_id ?? `name:${row.patient_name_ar}`;
}

function markFirstPayments(
  payments: SessionPaymentRow[]
): DoctorLedgerPatientRow[] {
  const counts = new Map<string, number>();
  for (const p of payments) {
    const key = patientKey(p);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  return payments.map((p) => ({
    id: p.id,
    patient_id: p.patient_id,
    patient_name_ar: p.patient_name_ar,
    paid_amount: p.paid_amount,
    doctor_share: p.doctor_share,
    payment_date: p.payment_date,
    procedure_label: p.procedure_label,
    is_first_payment: counts.get(patientKey(p)) === 1,
    materials_cost: p.materials_cost,
    lab_notes: p.lab_notes,
  }));
}

/** فواتير رسمية من المحاسب (السجل التاريخي فقط — بدون تكرار المراجعين) */
export async function fetchDoctorLedgerInvoices(
  admin: SupabaseClient,
  doctorId: string,
  clinicId: string,
  filters: DoctorLedgerDateFilters = {}
): Promise<{ rows: DoctorLedgerInvoiceRow[]; total: number }> {
  const limit = Math.min(Math.max(filters.limit ?? 100, 1), 300);
  const offset = Math.max(filters.offset ?? 0, 0);

  const historyRows = await loadDoctorHistoryRecords(
    admin,
    clinicId,
    doctorId,
    filters
  );

  const invoiceRows: DoctorLedgerInvoiceRow[] = [];

  for (const row of historyRows) {
    if (Number(row.paid_amount ?? 0) <= 0) continue;
    invoiceRows.push(mapHistoryToInvoiceRow(row));
  }

  invoiceRows.sort((a, b) => b.invoice_date.localeCompare(a.invoice_date));

  return {
    rows: invoiceRows.slice(offset, offset + limit),
    total: invoiceRows.length,
  };
}

/** دفعات المراجعين — الأحدث أولاً */
export async function fetchDoctorLedgerPatients(
  admin: SupabaseClient,
  doctorId: string,
  clinicId: string,
  filters: DoctorLedgerDateFilters = {}
): Promise<{ rows: DoctorLedgerPatientRow[]; total: number }> {
  const limit = Math.min(Math.max(filters.limit ?? 200, 1), 300);

  const payments = await fetchDoctorSessionPayments(
    admin,
    doctorId,
    clinicId,
    filters
  );

  const rows = markFirstPayments(payments).slice(0, limit);
  return { rows, total: payments.length };
}

/** سحوبات + رواتب + خصومات مساعدين — بدون فواتير (الصرفيات في تبويب الفواتير) */
export async function fetchDoctorLedgerFinancialOps(
  admin: SupabaseClient,
  doctorId: string,
  clinicId: string,
  filters: DoctorLedgerDateFilters = {}
): Promise<{ rows: DoctorLedgerOperationRow[]; total: number }> {
  const limit = Math.min(Math.max(filters.limit ?? 100, 1), 200);
  const rows: DoctorLedgerOperationRow[] = [];

  const withdrawalSelectFull =
    "id, amount, status, source, requested_at, processed_at, notes";
  const withdrawalSelectBase =
    "id, amount, status, requested_at, processed_at";

  const withdrawalsQuery = admin
    .from("doctor_withdrawals")
    .select(withdrawalSelectFull)
    .eq("doctor_id", doctorId)
    .order("requested_at", { ascending: false })
    .limit(200);

  let withdrawalsRes = await withdrawalsQuery;
  if (withdrawalsRes.error?.message?.includes("notes")) {
    withdrawalsRes = (await admin
      .from("doctor_withdrawals")
      .select(withdrawalSelectBase)
      .eq("doctor_id", doctorId)
      .order("requested_at", { ascending: false })
      .limit(200)) as typeof withdrawalsRes;
  }
  if (withdrawalsRes.error?.message?.includes("source")) {
    withdrawalsRes = (await admin
      .from("doctor_withdrawals")
      .select("id, amount, status, requested_at, processed_at")
      .eq("doctor_id", doctorId)
      .order("requested_at", { ascending: false })
      .limit(200)) as typeof withdrawalsRes;
  }

  const period =
    filters.dateFrom || filters.dateTo
      ? {
          from: filters.dateFrom ?? "1970-01-01",
          to: filters.dateTo ?? "2999-12-31",
        }
      : undefined;
  const withdrawalRows = filterWithdrawalsInPeriod(
    withdrawalsRes.data ?? [],
    period
  );

  const txSelectFull =
    "id, type, amount, transaction_date, description_ar, reference_type, reference_id, operation_id, patient_id";
  const txSelectBase =
    "id, type, amount, transaction_date, description_ar, reference_type, reference_id";

  let txQuery = admin
    .from("transactions")
    .select(txSelectFull)
    .eq("clinic_id", clinicId)
    .eq("doctor_id", doctorId)
    .in("type", ["doctor_salary_paid", "assistant_payroll_doctor"])
    .order("transaction_date", { ascending: false })
    .limit(150);

  if (filters.dateFrom) txQuery = txQuery.gte("transaction_date", filters.dateFrom);
  if (filters.dateTo) txQuery = txQuery.lte("transaction_date", filters.dateTo);

  let txRes = await txQuery;

  if (txRes.error?.message?.includes("operation_id")) {
    let fallback = admin
      .from("transactions")
      .select(txSelectBase)
      .eq("clinic_id", clinicId)
      .eq("doctor_id", doctorId)
      .in("type", [
        "doctor_salary_paid",
        "doctor_expense_doctor",
        "assistant_payroll_doctor",
      ])
      .order("transaction_date", { ascending: false })
      .limit(150);

    if (filters.dateFrom) {
      fallback = fallback.gte("transaction_date", filters.dateFrom);
    }
    if (filters.dateTo) {
      fallback = fallback.lte("transaction_date", filters.dateTo);
    }

    txRes = (await fallback) as typeof txRes;
  }

  let salaryEntriesQuery = admin
    .from("salary_entries")
    .select("id, entry_type, amount, entry_date, notes_ar")
    .eq("clinic_id", clinicId)
    .eq("doctor_id", doctorId)
    .order("entry_date", { ascending: false })
    .limit(100);

  if (filters.dateFrom) {
    salaryEntriesQuery = salaryEntriesQuery.gte("entry_date", filters.dateFrom);
  }
  if (filters.dateTo) {
    salaryEntriesQuery = salaryEntriesQuery.lte("entry_date", filters.dateTo);
  }

  const [txResFinal, salaryEntriesRes] = await Promise.all([
    Promise.resolve(txRes),
    salaryEntriesQuery,
  ]);

  if (txResFinal.error) throw new Error(txResFinal.error.message);

  if (!withdrawalsRes.error) {
    for (const w of withdrawalRows) {
      const status = w.status as WithdrawalStatus;
      const date = withdrawalEffectiveDate(w);
      const source = (w as { source?: string | null }).source;
      const notes = (w as { notes?: string | null }).notes?.trim();
      const sourceLabel = withdrawalSourceLabel(source);
      rows.push({
        id: w.id as string,
        kind: "withdrawal",
        label: notes
          ? `${sourceLabel} — ${withdrawalStatusLabel(status)} — ${notes}`
          : `${sourceLabel} — ${withdrawalStatusLabel(status)}`,
        amount: Number(w.amount ?? 0),
        operation_date: date,
        status,
      });
    }
  }

  for (const tx of txResFinal.data ?? []) {
    const txRow = tx as Record<string, unknown>;
    if (txRow.operation_id || txRow.patient_id) continue;

    const type = txRow.type as string;
    const amount = Math.abs(Number(txRow.amount ?? 0));
    let kind: DoctorLedgerOperationKind;
    let label: string;

    switch (type) {
      case "doctor_salary_paid":
        kind = "salary_payout";
        label = (txRow.description_ar as string) || "صرف راتب شهري";
        break;
      case "assistant_payroll_doctor":
        kind = "payroll_deduction";
        label = (txRow.description_ar as string) || "خصم راتب مساعد";
        break;
      default:
        continue;
    }

    rows.push({
      id: txRow.id as string,
      kind,
      label,
      amount,
      operation_date: txRow.transaction_date as string,
    });
  }

  for (const entry of salaryEntriesRes.data ?? []) {
    const entryType = entry.entry_type as SalaryEntryType;
    const typeLabel =
      SALARY_ENTRY_TYPE_LABELS[entryType] ?? String(entry.entry_type);
    const notes = (entry.notes_ar as string | null)?.trim();
    rows.push({
      id: entry.id as string,
      kind: "salary_adjustment",
      label: notes ? `${typeLabel} — ${notes}` : typeLabel,
      amount: Number(entry.amount ?? 0),
      operation_date: entry.entry_date as string,
      status: entryType,
    });
  }

  rows.sort((a, b) => b.operation_date.localeCompare(a.operation_date));

  return { rows: rows.slice(0, limit), total: rows.length };
}

function splitOperations(rows: DoctorLedgerOperationRow[]) {
  return {
    withdrawals: rows.filter((r) => r.kind === "withdrawal"),
    salary_payouts: rows.filter((r) => r.kind === "salary_payout"),
    salary_adjustments: rows.filter((r) => r.kind === "salary_adjustment"),
    expense_deductions: rows.filter((r) => r.kind === "expense_deduction"),
    payroll_deductions: rows.filter((r) => r.kind === "payroll_deduction"),
  };
}

/** تقرير مالي مفصّل */
export async function fetchDoctorFinancialReport(
  admin: SupabaseClient,
  doctorId: string,
  clinicId: string,
  filters: DoctorLedgerDateFilters,
  wallet: { totalEarnings: number; availableBalance: number }
): Promise<DoctorFinancialReportData> {
  const [invoicesRes, patientsRes, opsRes] = await Promise.all([
    fetchDoctorLedgerInvoices(admin, doctorId, clinicId, {
      ...filters,
      limit: 500,
    }),
    fetchDoctorLedgerPatients(admin, doctorId, clinicId, {
      ...filters,
      limit: 500,
    }),
    fetchDoctorLedgerFinancialOps(admin, doctorId, clinicId, {
      ...filters,
      limit: 500,
    }),
  ]);

  const split = splitOperations(opsRes.rows);

  const expenseInvoices = invoicesRes.rows.filter(
    (r) => r.record_kind === "doctor_expense"
  );
  const expenseDeductions: DoctorLedgerOperationRow[] = expenseInvoices.map(
    (inv) => ({
      id: inv.id,
      kind: "expense_deduction" as const,
      label: inv.procedure_label || "صرفية عيادة",
      amount: inv.doctor_share,
      operation_date: inv.invoice_date,
    })
  );

  const totalCollected = patientsRes.rows.reduce((s, r) => s + r.paid_amount, 0);
  const totalShare = patientsRes.rows.reduce((s, r) => s + r.doctor_share, 0);
  const totalWithdrawn = split.withdrawals
    .filter((r) => r.status !== "rejected" && r.status !== "pending")
    .reduce((s, r) => s + r.amount, 0);
  const totalSalary = split.salary_payouts.reduce((s, r) => s + r.amount, 0);
  const totalExpense = expenseDeductions.reduce((s, r) => s + r.amount, 0);
  const totalPayroll = split.payroll_deductions.reduce((s, r) => s + r.amount, 0);

  const { data: doctor } = await admin
    .from("doctors")
    .select("full_name_ar")
    .eq("id", doctorId)
    .maybeSingle();

  const netHint =
    Math.round(
      (totalShare - totalWithdrawn - totalSalary - totalExpense - totalPayroll) *
        100
    ) / 100;

  return {
    doctor_name_ar: (doctor?.full_name_ar as string) || "طبيب",
    date_from: filters.dateFrom ?? null,
    date_to: filters.dateTo ?? null,
    total_earnings: wallet.totalEarnings,
    available_balance: wallet.availableBalance,
    total_collected_from_patients:
      Math.round(totalCollected * 100) / 100,
    total_doctor_share_from_sessions: Math.round(totalShare * 100) / 100,
    total_withdrawn: Math.round(totalWithdrawn * 100) / 100,
    total_salary_paid: Math.round(totalSalary * 100) / 100,
    total_expense_deductions: Math.round(totalExpense * 100) / 100,
    total_payroll_deductions: Math.round(totalPayroll * 100) / 100,
    net_calc_hint: netHint,
    invoices: invoicesRes.rows,
    patient_payments: patientsRes.rows,
    withdrawals: split.withdrawals,
    salary_payouts: split.salary_payouts,
    salary_adjustments: split.salary_adjustments,
    expense_deductions: expenseDeductions,
    payroll_deductions: split.payroll_deductions,
  };
}
