/** صفحة ملف المريض في واجهة الطبيب */
export function buildDoctorPatientUrl(patientId: string) {
  return `/doctor/patients/${patientId}`;
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
