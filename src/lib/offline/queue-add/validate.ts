import { trimQueueIntakeNotes } from "@/lib/queue/intake-notes";
import { validatePatientPhone } from "@/lib/phone";
import { isOfflinePatientRef, type QueueAddOfflinePayload } from "@/lib/offline/types";
import { getCachedOfflineDoctors } from "@/lib/offline/reference-cache";

export interface QueueAddOfflineInput {
  clinicId: string | null;
  doctorId: string;
  patientName: string;
  patientPhone: string;
  patientId?: string | null;
  sendToDoctor: boolean;
  notes?: string | null;
}

export function validateQueueAddOffline(
  input: QueueAddOfflineInput
): { ok: true; payload: Omit<QueueAddOfflinePayload, "clientId" | "enqueuedAt"> } | { ok: false; message: string } {
  if (!input.clinicId) {
    return {
      ok: false,
      message:
        "لا يمكن الإضافة بدون نت — افتح صفحة الطابور مرة مع اتصال أولاً",
    };
  }

  if (!input.doctorId) {
    return { ok: false, message: "اختر الطبيب" };
  }

  const doctors = getCachedOfflineDoctors(input.clinicId);
  if (doctors.length > 0 && !doctors.some((d) => d.id === input.doctorId)) {
    return { ok: false, message: "الطبيب غير موجود في القائمة المحفوظة محلياً" };
  }

  const patientName = input.patientName.trim();
  if (!patientName) {
    return { ok: false, message: "أدخل اسم المراجع" };
  }

  const phoneRaw = input.patientPhone.trim();
  let normalizedPhone = phoneRaw;
  if (phoneRaw) {
    const phoneCheck = validatePatientPhone(phoneRaw);
    if (!phoneCheck.ok) {
      return { ok: false, message: phoneCheck.message };
    }
    normalizedPhone = phoneCheck.normalized;
  }

  const patientId =
    input.patientId && !isOfflinePatientRef(input.patientId)
      ? input.patientId
      : null;

  return {
    ok: true,
    payload: {
      version: 1,
      clinicId: input.clinicId,
      doctorId: input.doctorId,
      patientName,
      patientPhone: normalizedPhone,
      patientId,
      sendToDoctor: input.sendToDoctor,
      notes: trimQueueIntakeNotes(input.notes),
    },
  };
}
