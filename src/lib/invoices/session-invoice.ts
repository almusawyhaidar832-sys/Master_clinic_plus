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
    procedureLabel: extras.procedureLabel || opName(op),
    ...extras,
  });
}
