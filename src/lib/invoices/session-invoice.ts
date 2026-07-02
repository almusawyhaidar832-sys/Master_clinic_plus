import { getClinicDisplayName, formatDoctorDisplayName } from "@/lib/services/clinic-profile";
import { formatCurrency, formatDate } from "@/lib/utils";
import type { ClinicProfile } from "@/types/clinic-profile";
import type { PatientOperation } from "@/types";
import { opName } from "@/types";

export interface SessionInvoiceData {
  operationId: string;
  invoiceId?: string | null;
  doctorId?: string | null;
  patientId?: string | null;
  invoiceNumber: string;
  issuedAt: string;
  clinic: ClinicProfile | null;
  patientName: string;
  patientPhone: string | null;
  doctorName: string;
  procedureLabel: string;
  treatmentName: string;
  sessionDate: string;
  paidThisSession: number;
  caseTotalAmount: number;
  caseTotalPaid: number;
  remainingBalance: number;
  treatmentCompleted: boolean;
  sessionNumber?: number;
  totalSessionsInCase?: number;
  notes?: string | null;
  labNotes?: string | null;
  materialsCost?: number;
  /** نسبة تحمّل الطبيب لتكلفة المختبر (materials_share) */
  materialsSharePct?: number;
  /** تحمّل الطبيب والعيادة من تكلفة المختبر */
  labDoctorShare?: number;
  labClinicShare?: number;
  /** حصة الطبيب والعيادة على السعر النهائي للحالة (للمراجعة الداخلية) */
  doctorShareTotal?: number;
  clinicShareTotal?: number;
}

export function buildInvoiceNumber(operationId: string): string {
  const short = operationId.replace(/-/g, "").slice(0, 8).toUpperCase();
  const d = new Date();
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  return `INV-${ymd}-${short}`;
}

export function buildSessionInvoiceData(input: {
  operation: PatientOperation;
  clinic: ClinicProfile | null;
  patientName: string;
  patientPhone: string | null;
  doctorName: string;
  procedureLabel: string;
  treatmentName: string;
  paidThisSession: number;
  caseTotalAmount: number;
  caseTotalPaid: number;
  remainingBalance: number;
  treatmentCompleted: boolean;
  sessionNumber?: number;
  totalSessionsInCase?: number;
  notes?: string | null;
  labNotes?: string | null;
  materialsCost?: number;
  materialsSharePct?: number;
  labDoctorShare?: number;
  labClinicShare?: number;
  doctorShareTotal?: number;
  clinicShareTotal?: number;
}): SessionInvoiceData {
  return {
    operationId: input.operation.id,
    doctorId: input.operation.doctor_id ?? null,
    patientId: input.operation.patient_id ?? null,
    invoiceNumber: buildInvoiceNumber(input.operation.id),
    issuedAt: new Date().toISOString(),
    clinic: input.clinic,
    patientName: input.patientName,
    patientPhone: input.patientPhone,
    doctorName: input.doctorName,
    procedureLabel: input.procedureLabel,
    treatmentName: input.treatmentName,
    sessionDate: input.operation.operation_date ?? formatDate(new Date()),
    paidThisSession: input.paidThisSession,
    caseTotalAmount: input.caseTotalAmount,
    caseTotalPaid: input.caseTotalPaid,
    remainingBalance: input.remainingBalance,
    treatmentCompleted: input.treatmentCompleted,
    sessionNumber: input.sessionNumber,
    totalSessionsInCase: input.totalSessionsInCase,
    notes: input.notes ?? input.operation.notes,
    labNotes: input.labNotes ?? input.operation.lab_notes ?? null,
    materialsCost:
      (input.materialsCost ??
        Number(input.operation.materials_cost ?? 0)) || undefined,
    materialsSharePct: input.materialsSharePct,
    labDoctorShare: input.labDoctorShare,
    labClinicShare: input.labClinicShare,
    doctorShareTotal: input.doctorShareTotal,
    clinicShareTotal: input.clinicShareTotal,
  };
}

/** رسالة واتساب احترافية للفاتورة */
export function sessionInvoiceWhatsAppMessage(data: SessionInvoiceData): string {
  const clinicName = getClinicDisplayName(data.clinic);
  const doctor = formatDoctorDisplayName(data.doctorName);
  const paid = formatCurrency(data.paidThisSession);
  const remaining = formatCurrency(data.remainingBalance);
  const total = formatCurrency(data.caseTotalAmount);

  let body = `🧾 *إيصال دفع — ${clinicName}*

مرحباً ${data.patientName}،`;

  if (data.notes?.trim()) {
    body += `

📝 *ملاحظات:*
${data.notes.trim()}`;
  }

  body += `

📋 رقم الإيصال: ${data.invoiceNumber}
📅 التاريخ: ${formatDate(data.sessionDate)}
👨‍⚕️ الطبيب: ${doctor}

*تفاصيل الجلسة:*
• الإجراء: ${data.procedureLabel}
• الحالة العلاجية: ${data.treatmentName}`;

  if (
    data.sessionNumber &&
    data.totalSessionsInCase &&
    data.totalSessionsInCase > 0
  ) {
    body += `\n• الجلسة: ${data.sessionNumber} من ${data.totalSessionsInCase}`;
  }

  body += `

*المبالغ:*
✅ المدفوع في هذه الجلسة: *${paid}*
📊 إجمالي الحالة: ${total}
💰 المتبقي (الذمة): ${remaining}`;

  if (data.treatmentCompleted) {
    body += `

🎉 *تم إكمال العلاج بنجاح*
لا توجد ذمة متبقية — شكراً لثقتكم ومتابعتكم معنا حتى النهاية.`;
  } else if (data.remainingBalance > 0) {
    body += `

نرجوكم مراجعة العيادة لإتمام باقي الخطة العلاجية.`;
  }

  if (data.clinic?.phone) {
    body += `\n\n📞 للاستفسار: ${data.clinic.phone}`;
  }

  body += `\n\nمع تحيات فريق ${clinicName} الطبي.`;

  return body;
}

/** بناء بيانات الفاتورة من عملية محفوظة */
export function invoiceFromOperation(
  op: PatientOperation,
  extras: Omit<
    Parameters<typeof buildSessionInvoiceData>[0],
    "operation"
  >
): SessionInvoiceData {
  return buildSessionInvoiceData({
    operation: op,
    ...extras,
    procedureLabel: extras.procedureLabel || opName(op),
  });
}

/** مبالغ العرض في السجل التاريخي — من الصف أو اللقطة المحفوظة */
export function historyRowFinancials(row: {
  record_kind?: string;
  doctor_expense_id?: string | null;
  procedure_label?: string;
  treatment_name?: string;
  total_amount?: number;
  paid_amount?: number;
  remaining_amount?: number;
  operation_id?: string | null;
  snapshot_json?: SessionInvoiceData | Record<string, unknown>;
}) {
  if (row.record_kind === "doctor_expense" || row.doctor_expense_id) {
    return null;
  }

  const snap =
    row.snapshot_json && typeof row.snapshot_json === "object"
      ? (row.snapshot_json as SessionInvoiceData)
      : null;

  const paidSession = Math.max(
    Number(row.paid_amount ?? 0),
    Number(snap?.paidThisSession ?? 0)
  );
  const caseTotal = Math.max(
    Number(row.total_amount ?? 0),
    Number(snap?.caseTotalAmount ?? 0)
  );
  const remaining = Math.max(
    Number(row.remaining_amount ?? 0),
    Number(snap?.remainingBalance ?? 0)
  );
  const casePaid = Math.max(
    Number(snap?.caseTotalPaid ?? 0),
    caseTotal > 0 ? Math.max(0, caseTotal - remaining) : paidSession
  );

  const treatmentName =
    String(snap?.treatmentName ?? row.treatment_name ?? row.procedure_label ?? "")
      .trim() || "—";

  return {
    treatmentName,
    paidSession,
    caseTotal,
    casePaid,
    remaining,
    canResend: Boolean(snap?.operationId ?? row.operation_id),
  };
}

export function canResendHistoryInvoice(row: {
  record_kind?: string;
  doctor_expense_id?: string | null;
  operation_id?: string | null;
  invoice_id?: string | null;
  snapshot_json?: SessionInvoiceData | Record<string, unknown>;
}): boolean {
  if (row.record_kind === "doctor_expense" || row.doctor_expense_id) {
    return false;
  }
  const snap =
    row.snapshot_json && typeof row.snapshot_json === "object"
      ? (row.snapshot_json as SessionInvoiceData)
      : null;
  return Boolean(snap?.operationId ?? row.operation_id ?? row.invoice_id);
}

/** استرجاع بيانات الفاتورة من صف السجل التاريخي — لإعادة الإرسال على واتساب */
export function sessionInvoiceFromHistoryRow(
  row: {
    record_kind?: string;
    doctor_expense_id?: string | null;
    operation_id: string | null;
    invoice_id: string | null;
    invoice_number: string;
    patient_id: string | null;
    doctor_id: string | null;
    patient_name_ar: string;
    doctor_name_ar: string;
    procedure_label: string;
    treatment_name: string;
    total_amount: number;
    paid_amount: number;
    remaining_amount: number;
    invoice_date: string;
    snapshot_json: SessionInvoiceData | Record<string, unknown>;
  },
  clinic: ClinicProfile | null
): SessionInvoiceData | null {
  if (row.record_kind === "doctor_expense" || row.doctor_expense_id) {
    return null;
  }

  const snap =
    row.snapshot_json && typeof row.snapshot_json === "object"
      ? (row.snapshot_json as SessionInvoiceData)
      : null;

  const operationId =
    snap?.operationId ?? row.operation_id ?? "";
  if (!operationId) return null;

  return {
    ...(snap ?? ({} as SessionInvoiceData)),
    operationId,
    invoiceId: snap?.invoiceId ?? row.invoice_id ?? null,
    doctorId: snap?.doctorId ?? row.doctor_id ?? null,
    patientId: snap?.patientId ?? row.patient_id ?? null,
    invoiceNumber: snap?.invoiceNumber ?? row.invoice_number,
    issuedAt: snap?.issuedAt ?? row.invoice_date,
    clinic: snap?.clinic ?? clinic,
    patientName: snap?.patientName ?? row.patient_name_ar ?? "مراجع",
    patientPhone: snap?.patientPhone ?? null,
    doctorName: snap?.doctorName ?? row.doctor_name_ar ?? "—",
    procedureLabel: snap?.procedureLabel ?? row.procedure_label,
    treatmentName: snap?.treatmentName ?? row.treatment_name,
    sessionDate: snap?.sessionDate ?? row.invoice_date,
    paidThisSession: snap?.paidThisSession ?? row.paid_amount,
    caseTotalAmount: snap?.caseTotalAmount ?? row.total_amount,
    caseTotalPaid:
      snap?.caseTotalPaid ??
      Math.max(0, row.total_amount - row.remaining_amount),
    remainingBalance: snap?.remainingBalance ?? row.remaining_amount,
    treatmentCompleted: snap?.treatmentCompleted ?? row.remaining_amount <= 0,
  };
}
