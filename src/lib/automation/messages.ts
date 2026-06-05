import { formatCurrency } from "@/lib/utils";
import { getClinicDisplayName } from "@/lib/services/clinic-profile";
import { FINANCIAL_EPSILON } from "@/lib/services/patient-financial-plan";
import type { ClinicProfile } from "@/types/clinic-profile";

const SESSION_ORDINAL_AR: Record<number, string> = {
  1: "الأولى",
  2: "الثانية",
  3: "الثالثة",
  4: "الرابعة",
  5: "الخامسة",
  6: "السادسة",
  7: "السابعة",
  8: "الثامنة",
  9: "التاسعة",
  10: "العاشرة",
};

/** حالة العلاج من ذمة الحالة فقط — لا من patients.treatment_status */
export function treatmentStatusAr(
  _status: string | null | undefined,
  remaining: number,
  caseFinalPrice?: number
): string {
  const finalP =
    caseFinalPrice != null && Number.isFinite(caseFinalPrice)
      ? caseFinalPrice
      : 0;
  if (finalP > FINANCIAL_EPSILON && remaining <= FINANCIAL_EPSILON) {
    return "مكتملة";
  }
  return "قيد العلاج";
}

export type SessionWhatsAppKind = "first" | "follow_up" | "completed";

export function resolveSessionWhatsAppKind(
  sessionNumber: number,
  treatmentCompleted: boolean
): SessionWhatsAppKind {
  if (treatmentCompleted) return "completed";
  if (sessionNumber <= 1) return "first";
  return "follow_up";
}

type CaseLinkedOperation = {
  id: string;
  treatment_case_id?: string | null;
};

/**
 * COUNT(*) WHERE treatment_case_id = caseId
 * لا يُعدّ كل جلسات المراجع — فقط جلسات هذه الحالة.
 */
export function countSessionsByCaseId(
  operations: CaseLinkedOperation[],
  caseId: string,
  currentOperationId?: string
): number {
  const cid = caseId.trim();
  if (!cid) return 1;

  const linked = operations.filter((o) => o.treatment_case_id?.trim() === cid);
  if (
    currentOperationId &&
    !linked.some((o) => o.id === currentOperationId)
  ) {
    return Math.max(1, linked.length + 1);
  }
  return Math.max(1, linked.length);
}

/** سطر تقدم الجلسة — رقم الجلسة وإجمالي جلسات هذه الحالة فقط */
export function sessionProgressLineAr(
  sessionNumber: number,
  totalInCase?: number
): string {
  const n = Math.max(1, Math.round(sessionNumber));
  const total = Math.max(n, Math.round(totalInCase ?? n));
  const ordinal = SESSION_ORDINAL_AR[n];
  const label = ordinal ? `الجلسة ${ordinal}` : `الجلسة رقم ${n}`;
  return `تم *إكمال ${label} من أصل ${total}*`;
}

export type FormattedSessionMessageParams = {
  clinic?: ClinicProfile | null;
  clinicName?: string;
  patientName: string;
  doctorName: string;
  caseId: string | null;
  operations: CaseLinkedOperation[];
  currentOperationId: string;
  paidThisSession: number;
  /** المتبقي لهذه الحالة تحديداً */
  remainingBalance: number;
  treatmentStatus: string;
  procedureLabel: string;
  teethSummary?: string;
  /** من استعلام COUNT مباشر قبل الإرسال */
  sessionCountFromDb?: number;
  totalSessionsInCase?: number;
  caseFinalPrice?: number;
};

/**
 * بناء رسالة الواتساب:
 * - العد: COUNT WHERE case_id = الحالة الحالية
 * - remaining_balance = 0 → اكتمال العلاج
 * - غير ذلك → الجلسة الأولى / الثانية / رقم X
 */
export function getFormattedSessionMessage(
  params: FormattedSessionMessageParams
): string {
  const clinicName =
    params.clinicName ?? getClinicDisplayName(params.clinic ?? null);
  const paid = formatCurrency(Math.max(0, params.paidThisSession));
  const remaining = formatCurrency(Math.max(0, params.remainingBalance));
  const doctorLine = params.doctorName.trim() || "فريقنا الطبي";
  const sessionNumber =
    params.sessionCountFromDb != null &&
    Number.isFinite(params.sessionCountFromDb)
      ? Math.max(1, Math.round(params.sessionCountFromDb))
      : 1;
  const totalInCase = Math.max(
    sessionNumber,
    Math.round(params.totalSessionsInCase ?? sessionNumber)
  );
  const caseFinal =
    params.caseFinalPrice != null && Number.isFinite(params.caseFinalPrice)
      ? params.caseFinalPrice
      : 0;
  const treatmentCompleted =
    caseFinal > FINANCIAL_EPSILON &&
    params.remainingBalance <= FINANCIAL_EPSILON;

  const teethBlock = params.teethSummary
    ? `\n\n🦷 تفاصيل إضافية:\n${params.teethSummary}`
    : "";

  const summary = `ملخص زيارتك:
• الإجراء: ${params.procedureLabel}
• الحالة: ${params.treatmentStatus}
• المبلغ المدفوع: ${paid}
• المبلغ المتبقي (الذمة): ${remaining}${teethBlock}`;

  const footer = `نحن نهتم لأدق التفاصيل في علاجك، ونتمنى لك دوام الصحة والشفاء العاجل. ابتسامتك هي نجاحنا!

مع تحيات فريق ${clinicName} الطبي.`;

  if (treatmentCompleted) {
    return `🎉 *تم إكمال العلاج بنجاح*

أهلاً بك يا ${params.patientName} في ${clinicName}.

يسعدنا إبلاغك بأنه قد *اكتملت خطتك العلاجية بالكامل* تحت إشراف الدكتور/ة: ${doctorLine}.

لا توجد ذمة متبقية على هذه الحالة — شكراً لثقتكم ولمتابعتكم معنا حتى النهاية.

${summary}

${footer}`;
  }

  const progressLine = sessionProgressLineAr(sessionNumber, totalInCase);

  return `أهلاً بك يا ${params.patientName} في ${clinicName}.

${progressLine} بنجاح تحت إشراف الدكتور/ة: ${doctorLine}.

${summary}

نحن بانتظاركم في الجلسة القادمة لمتابعة خطتكم العلاجية.

${footer}`;
}

export function patientSessionWhatsAppMessage(params: {
  clinic?: ClinicProfile | null;
  clinicName?: string;
  patientName: string;
  doctorName: string;
  sessionNumber: number;
  totalSessionsInCase: number;
  paidThisSession: number;
  remainingBalance: number;
  treatmentStatus: string;
  procedureLabel: string;
  teethSummary?: string;
  kind: SessionWhatsAppKind;
  caseId?: string | null;
  operations?: CaseLinkedOperation[];
  currentOperationId?: string;
  sessionCountFromDb?: number;
  caseFinalPrice?: number;
}): string {
  return getFormattedSessionMessage({
    clinic: params.clinic,
    clinicName: params.clinicName,
    patientName: params.patientName,
    doctorName: params.doctorName,
    caseId: params.caseId ?? null,
    operations: params.operations ?? [],
    currentOperationId: params.currentOperationId ?? "",
    paidThisSession: params.paidThisSession,
    remainingBalance: params.remainingBalance,
    treatmentStatus: params.treatmentStatus,
    procedureLabel: params.procedureLabel,
    teethSummary: params.teethSummary,
    sessionCountFromDb: params.sessionCountFromDb ?? params.sessionNumber,
    totalSessionsInCase: params.totalSessionsInCase ?? params.sessionNumber,
    caseFinalPrice: params.caseFinalPrice,
  });
}

/** @deprecated استخدم patientSessionWhatsAppMessage */
export function sessionUpdateWhatsAppMessage(params: {
  clinic?: ClinicProfile | null;
  clinicName?: string;
  patientName: string;
  doctorName: string;
  sessionNumber: number;
  totalSessionsInCase?: number;
  paidThisSession: number;
  remainingBalance: number;
  treatmentStatus: string;
  procedureLabel: string;
  teethSummary?: string;
  treatmentCompleted?: boolean;
}): string {
  const kind = resolveSessionWhatsAppKind(
    params.sessionNumber,
    Boolean(params.treatmentCompleted)
  );
  return patientSessionWhatsAppMessage({
    ...params,
    totalSessionsInCase: params.totalSessionsInCase ?? params.sessionNumber,
    kind,
  });
}

export function xrayLinkWhatsAppMessage(params: {
  clinic?: ClinicProfile | null;
  clinicName?: string;
  patientName: string;
  sessionNumber: number;
  totalSessionsInCase?: number;
  imageUrl: string;
  fileName?: string | null;
}): string {
  const clinicName =
    params.clinicName ?? getClinicDisplayName(params.clinic ?? null);
  const nameLine = params.fileName ? `\n📎 ${params.fileName}` : "";

  return `عزيزنا/عزيزتنا ${params.patientName}،

🏥 ${clinicName}
📋 الجلسة رقم ${params.sessionNumber} من أصل ${Math.max(1, params.totalSessionsInCase ?? params.sessionNumber)}

تم رفع صورة أشعة لسجلّكم:${nameLine}

🔗 رابط الصورة (صالح لمدة 24 ساعة):
${params.imageUrl}

يرجى فتح الرابط من جوالكم.`;
}

export function doctorPaymentAlertMessage(params: {
  patientName: string;
  paidAmount: number;
  remainingBalance: number;
  procedureLabel: string;
  teethSummary?: string;
  sessionNumber: number;
  totalSessionsInCase?: number;
}): string {
  const teethBlock = params.teethSummary
    ? `\n🦷 الأسنان: ${params.teethSummary}`
    : "";
  const total = Math.max(1, params.totalSessionsInCase ?? params.sessionNumber);

  return `🔔 دفعة جديدة — جلسة ${params.sessionNumber} من أصل ${total}

👤 ${params.patientName}
💰 مدفوع: ${formatCurrency(params.paidAmount)}
📊 متبقي: ${formatCurrency(Math.max(0, params.remainingBalance))}
📝 ${params.procedureLabel}${teethBlock}`;
}

export function doctorPaymentAlertTitle(): string {
  return "دفعة / جلسة مراجع";
}
