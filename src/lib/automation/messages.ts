import { formatCurrency } from "@/lib/utils";
import { getClinicDisplayName } from "@/lib/services/clinic-profile";
import type { ClinicProfile } from "@/types/clinic-profile";

export function treatmentStatusAr(
  status: string | null | undefined,
  remaining: number
): string {
  if (status === "completed" || remaining <= 0) return "مكتملة";
  if (status === "active") return "قيد العلاج";
  return "متابعة";
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

export function patientSessionWhatsAppMessage(params: {
  clinic?: ClinicProfile | null;
  clinicName?: string;
  patientName: string;
  doctorName: string;
  sessionNumber: number;
  paidThisSession: number;
  remainingBalance: number;
  treatmentStatus: string;
  procedureLabel: string;
  teethSummary?: string;
  kind: SessionWhatsAppKind;
}): string {
  const clinicName =
    params.clinicName ?? getClinicDisplayName(params.clinic ?? null);
  const paid = formatCurrency(Math.max(0, params.paidThisSession));
  const remaining = formatCurrency(Math.max(0, params.remainingBalance));
  const doctorLine = params.doctorName.trim() || "فريقنا الطبي";

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

  if (params.kind === "completed") {
    return `🎉 *تم إكمال العلاج بنجاح*

أهلاً بك يا ${params.patientName} في ${clinicName}.

يسعدنا إبلاغك بأنه قد *اكتملت خطتك العلاجية بالكامل* تحت إشراف الدكتور/ة: ${doctorLine}.

لا توجد ذمة متبقية على هذه الحالة — شكراً لثقتكم ولمتابعتكم معنا حتى النهاية.

${summary}

${footer}`;
  }

  if (params.kind === "first") {
    return `أهلاً بك يا ${params.patientName} في ${clinicName}.

يسعدنا جداً أن نكون جزءاً من رحلتك نحو ابتسامة صحية وجميلة!

تم *إكمال الجلسة الأولى* بنجاح تحت إشراف الدكتور/ة: ${doctorLine}.

سنوافيكم برسالة بعد كل جلسة حتى اكتمال العلاج بالكامل.

${summary}

نحن بانتظاركم في الجلسة القادمة لمتابعة خطتكم العلاجية.

${footer}`;
  }

  return `أهلاً بك يا ${params.patientName} في ${clinicName}.

تم *إكمال الجلسة رقم ${params.sessionNumber}* بنجاح تحت إشراف الدكتور/ة: ${doctorLine}.

نحن بانتظارك في الجلسة القادمة لمتابعة باقي خطتك العلاجية.

${summary}

${footer}`;
}

/** @deprecated استخدم patientSessionWhatsAppMessage */
export function sessionUpdateWhatsAppMessage(params: {
  clinic?: ClinicProfile | null;
  clinicName?: string;
  patientName: string;
  doctorName: string;
  sessionNumber: number;
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
  return patientSessionWhatsAppMessage({ ...params, kind });
}

export function xrayLinkWhatsAppMessage(params: {
  clinic?: ClinicProfile | null;
  clinicName?: string;
  patientName: string;
  sessionNumber: number;
  imageUrl: string;
  fileName?: string | null;
}): string {
  const clinicName =
    params.clinicName ?? getClinicDisplayName(params.clinic ?? null);
  const nameLine = params.fileName ? `\n📎 ${params.fileName}` : "";

  return `عزيزنا/عزيزتنا ${params.patientName}،

🏥 ${clinicName}
📋 الجلسة رقم ${params.sessionNumber}

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
}): string {
  const teethBlock = params.teethSummary
    ? `\n🦷 الأسنان: ${params.teethSummary}`
    : "";

  return `🔔 دفعة جديدة — جلسة ${params.sessionNumber}

👤 ${params.patientName}
💰 مدفوع: ${formatCurrency(params.paidAmount)}
📊 متبقي: ${formatCurrency(Math.max(0, params.remainingBalance))}
📝 ${params.procedureLabel}${teethBlock}`;
}

export function doctorPaymentAlertTitle(): string {
  return "دفعة / جلسة مراجع";
}
