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

export type AppointmentUpdateAction =
  | "accepted"
  | "rejected"
  | "modified"
  | "created";

/** تحديث موعد — قبول / رفض / تعديل */
export function appointmentUpdateMessage(params: {
  patientName: string;
  date: string;
  time: string;
  endTime?: string;
  doctorName: string;
  clinic?: ClinicProfile | null;
  clinicName?: string;
  action: AppointmentUpdateAction;
  reasonForChange?: string | null;
}): string {
  const clinicName =
    params.clinicName ?? getClinicDisplayName(params.clinic ?? null);
  const doctor = formatDoctorDisplayName(params.doctorName);
  const timeLine = params.endTime
    ? `${params.time} – ${params.endTime}`
    : params.time;

  const actionIntro: Record<AppointmentUpdateAction, string> = {
    accepted: "تم تأكيد موعدكم",
    rejected: "نعتذر — تم رفض طلب الحجز",
    modified: "تم تعديل موعدكم",
    created: "تم تسجيل موعدكم",
  };

  let body = `مرحباً ${params.patientName}،

${actionIntro[params.action]} في ${clinicName} مع ${doctor}:
📅 التاريخ: ${params.date}
🕐 الوقت: ${timeLine}`;

  if (params.reasonForChange?.trim()) {
    body += `\n\n📝 سبب التغيير: ${params.reasonForChange.trim()}`;
  }

  if (params.action === "rejected") {
    body += "\n\nللاستفسار أو حجز موعد آخر يرجى الرد على هذه الرسالة.";
  } else {
    body += "\n\nنتطلع لرؤيتكم. للاستفسار يرجى الرد على هذه الرسالة.";
  }

  return body;
}

/** رسالة تجريبية — اختبار ربط WhatsApp API */
export function testNotificationMessage(clinicName: string): string {
  return `🔔 رسالة تجريبية من ${clinicName}

هذه رسالة اختبار من نظام Master Clinic Plus.
إذا وصلتك، فربط الواتساب يعمل بشكل صحيح.`;
}
