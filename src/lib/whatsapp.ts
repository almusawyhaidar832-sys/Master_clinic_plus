import {
  getClinicDisplayName,
  formatDoctorDisplayName,
} from "@/lib/services/clinic-profile";
import type { ClinicProfile } from "@/types/clinic-profile";

/** Arabic WhatsApp templates — clinic & doctor names injected dynamically */

export function appointmentConfirmationMessage(params: {
  patientName: string;
  date: string;
  time: string;
  doctorName: string;
  clinic?: ClinicProfile | null;
  clinicName?: string;
}): string {
  const clinicName =
    params.clinicName ?? getClinicDisplayName(params.clinic ?? null);
  const doctor = formatDoctorDisplayName(params.doctorName);

  return `مرحباً ${params.patientName}،

تم تأكيد موعدكم في ${clinicName} مع ${doctor}:
📅 التاريخ: ${params.date}
🕐 الوقت: ${params.time}

نتطلع لرؤيتكم. للاستفسار يرجى الرد على هذه الرسالة.`;
}

export function paymentReceiptMessage(params: {
  patientName: string;
  paidAmount: string;
  clinic?: ClinicProfile | null;
  clinicName?: string;
  doctorName?: string | null;
}): string {
  const clinicName =
    params.clinicName ?? getClinicDisplayName(params.clinic ?? null);
  const doctorLine = params.doctorName
    ? `\n👨‍⚕️ بإشراف ${formatDoctorDisplayName(params.doctorName)}`
    : "";

  return `عزيزنا/عزيزتنا ${params.patientName}،

شكراً لكم على زيارتكم ${clinicName}.${doctorLine}
✅ تم استلام مبلغ: ${params.paidAmount}

نقدّر ثقتكم بنا ونتمنى لكم دوام الصحة والعافية.`;
}

/** رسالة تجريبية — اختبار ربط WhatsApp API */
export function testNotificationMessage(clinicName: string): string {
  return `🔔 رسالة تجريبية من ${clinicName}

هذه رسالة اختبار من نظام Master Clinic Plus.
إذا وصلتك، فربط الواتساب يعمل بشكل صحيح.`;
}
