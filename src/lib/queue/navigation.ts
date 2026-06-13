/** صفحة ملف المريض في واجهة الطبيب */
export function buildDoctorPatientUrl(patientId: string) {
  return `/doctor/patients/${patientId}`;
}

export const CLINICAL_EXAM_ANCHOR = "clinical-exam";

/** غرفة الانتظار — السجل الطبي البصري مباشرة (مخطط + أشعة + وصفة) */
export function buildDoctorQueueClinicalUrl(input: {
  queueEntryId: string;
  patientId?: string | null;
}) {
  const params = new URLSearchParams({ exam: input.queueEntryId });
  if (input.patientId) params.set("patientId", input.patientId);
  return `/doctor/queue?${params.toString()}#${CLINICAL_EXAM_ANCHOR}`;
}

/** غرفة انتظار المساعد — نفس الشاشة السريرية */
export function buildAssistantQueueClinicalUrl(input: {
  queueEntryId: string;
  patientId?: string | null;
}) {
  const params = new URLSearchParams({ exam: input.queueEntryId });
  if (input.patientId) params.set("patientId", input.patientId);
  return `/assistant/queue?${params.toString()}#${CLINICAL_EXAM_ANCHOR}`;
}

export function scrollToClinicalExamView() {
  if (typeof window === "undefined") return;
  requestAnimationFrame(() => {
    document.getElementById(CLINICAL_EXAM_ANCHOR)?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  });
}

/** كشف حساب + سجل بصري — مع ربط الزيارة من الطابور */
export function buildDoctorStatementUrl(input: {
  patientId: string;
  queueEntryId?: string | null;
}) {
  const params = new URLSearchParams({ patientId: input.patientId });
  if (input.queueEntryId) {
    params.set("queue_entry_id", input.queueEntryId);
  }
  return `/doctor/statement?${params.toString()}`;
}
