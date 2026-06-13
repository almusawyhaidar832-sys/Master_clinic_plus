import type { AppointmentWithDoctor } from "@/hooks/useCentralizedAppointments";

function unwrapDoctor(
  doctor: unknown
): AppointmentWithDoctor["doctor"] {
  if (!doctor) return null;
  if (Array.isArray(doctor)) {
    const first = doctor[0];
    if (first && typeof first === "object") {
      return first as AppointmentWithDoctor["doctor"];
    }
    return null;
  }
  if (typeof doctor === "object") {
    return doctor as AppointmentWithDoctor["doctor"];
  }
  return null;
}

/** Normalize Supabase appointment rows for safe UI rendering. */
export function normalizeAppointmentRow(
  row: Record<string, unknown>
): AppointmentWithDoctor {
  return {
    ...(row as AppointmentWithDoctor),
    appointment_date: String(row.appointment_date ?? ""),
    start_time: String(row.start_time ?? ""),
    end_time: String(row.end_time ?? ""),
    patient_name_ar:
      row.patient_name_ar != null ? String(row.patient_name_ar) : null,
    patient_phone:
      row.patient_phone != null ? String(row.patient_phone) : null,
    notes: row.notes != null ? String(row.notes) : null,
    reason_for_change:
      row.reason_for_change != null ? String(row.reason_for_change) : null,
    status: String(row.status ?? "scheduled") as AppointmentWithDoctor["status"],
    doctor: unwrapDoctor(row.doctor),
  };
}

export function normalizeAppointmentRows(
  rows: Record<string, unknown>[] | null | undefined
): AppointmentWithDoctor[] {
  return (rows ?? []).map(normalizeAppointmentRow);
}
