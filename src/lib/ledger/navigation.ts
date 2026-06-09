/** بناء رابط إدخال الجلسة من موعد أو مريض */
export function buildLedgerPayUrl(input: {
  patientId?: string | null;
  appointmentId?: string | null;
  doctorId?: string | null;
}): string {
  const params = new URLSearchParams();

  if (input.patientId) {
    params.set("patient_id", input.patientId);
  }
  if (input.appointmentId) {
    params.set("appointment_id", input.appointmentId);
  }

  if (input.doctorId) {
    params.set("doctor_id", input.doctorId);
  }

  const qs = params.toString();
  return qs ? `/dashboard/ledger?${qs}` : "/dashboard/ledger";
}
