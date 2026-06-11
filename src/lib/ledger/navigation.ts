/** بناء رابط إدخال الجلسة من موعد أو مريض */
export function buildLedgerPayUrl(input: {
  patientId?: string | null;
  appointmentId?: string | null;
  doctorId?: string | null;
  queueEntryId?: string | null;
  patientName?: string | null;
  patientPhone?: string | null;
}): string {
  const params = new URLSearchParams();

  if (input.patientId) {
    params.set("patient_id", input.patientId);
  }
  if (input.appointmentId) {
    params.set("appointment_id", input.appointmentId);
  }
  if (input.queueEntryId) {
    params.set("queue_entry_id", input.queueEntryId);
  }

  if (input.doctorId) {
    params.set("doctor_id", input.doctorId);
  }

  const patientName = input.patientName?.trim();
  if (patientName) {
    params.set("patient_name", patientName);
  }

  const patientPhone = input.patientPhone?.trim();
  if (patientPhone) {
    params.set("patient_phone", patientPhone);
  }

  const qs = params.toString();
  return qs ? `/dashboard/ledger?${qs}` : "/dashboard/ledger";
}
