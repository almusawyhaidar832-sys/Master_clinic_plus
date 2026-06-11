import {
  getClinicDisplayName,
  formatDoctorDisplayName,
} from "@/lib/services/clinic-profile";
import type { PrescriptionPrintData } from "@/lib/prescriptions/types";
import { formatDate } from "@/lib/utils";

/** رسالة واتساب مرافقة لملف PDF الوصفة */
export function prescriptionWhatsAppMessage(data: PrescriptionPrintData): string {
  const clinicName = getClinicDisplayName(data.clinic);
  const doctor = formatDoctorDisplayName(data.doctorName);
  const meds = data.prescription.medications
    .map((m, i) => `${i + 1}. ${m.drug_name_ar}`)
    .join("\n");

  let body = `💊 *وصفة طبية — ${clinicName}*

مرحباً ${data.patientName}،

👨‍⚕️ الطبيب: ${doctor}
📅 التاريخ: ${formatDate(data.prescription.prescription_date)}`;

  if (data.prescription.diagnosis_ar?.trim()) {
    body += `\n\n🩺 *التشخيص:*\n${data.prescription.diagnosis_ar.trim()}`;
  }

  if (meds) {
    body += `\n\n*الأدوية:*\n${meds}`;
  }

  body += `\n\n📎 مرفق: ملف PDF للوصفة الطبية`;

  if (data.clinic?.phone) {
    body += `\n\n📞 للاستفسار: ${data.clinic.phone}`;
  }

  body += `\n\nمع تمنياتنا بالشفاء العاجل — ${clinicName}`;

  return body;
}
