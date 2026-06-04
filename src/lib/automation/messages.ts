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

export function sessionUpdateWhatsAppMessage(params: {
  clinic?: ClinicProfile | null;
  clinicName?: string;
  patientName: string;
  sessionNumber: number;
  paidThisSession: number;
  remainingBalance: number;
  treatmentStatus: string;
  procedureLabel: string;
  teethSummary?: string;
  treatmentCompleted?: boolean;
}): string {
  const clinicName =
    params.clinicName ?? getClinicDisplayName(params.clinic ?? null);
  const paid =
    params.paidThisSession > 0
      ? formatCurrency(params.paidThisSession)
      : "—";
  const remaining = formatCurrency(Math.max(0, params.remainingBalance));
  const teethBlock = params.teethSummary
    ? `\n🦷 مخطط الأسنان:\n${params.teethSummary}`
    : "";

  const header = params.treatmentCompleted
    ? `🎉 عزيزنا/عزيزتنا ${params.patientName}

✅ *تم إكمال الخطة العلاجية بنجاح*

نتمنى لكم دوام الصحة والعافية — يسعدنا رؤيتكم دائماً في ${clinicName}.
`
    : `عزيزنا/عزيزتنا ${params.patientName}،

🏥 *${clinicName}*
`;

  return `${header}
📋 الجلسة رقم: ${params.sessionNumber}
💊 الحالة العلاجية: ${params.treatmentStatus}
💰 المدفوع (هذه الجلسة): ${paid}
📊 المتبقي على الذمة: ${remaining}
📝 الإجراء: ${params.procedureLabel}${teethBlock}

للاستفسار ردّوا على هذه الرسالة. شكراً لثقتكم بنا.`;
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
