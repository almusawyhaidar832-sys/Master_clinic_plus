/** Shared queue helpers (safe for client + server) */

export function resolvePatientDisplayName(entry: {
  patient?: { full_name_ar: string } | null;
  patient_name?: string | null;
  ticket_number?: number;
}): string {
  return (
    entry.patient?.full_name_ar ??
    entry.patient_name?.trim() ??
    (entry.ticket_number ? `رقم ${entry.ticket_number}` : "مراجع")
  );
}
