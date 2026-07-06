import type { AppointmentWithDoctor } from "@/hooks/useCentralizedAppointments";
import { getPatientDisplayPhone } from "@/lib/phone";

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

function unwrapPatient(patient: unknown): {
  full_name_ar?: string | null;
  phone?: string | null;
  phone_number?: string | null;
} | null {
  if (!patient) return null;
  if (Array.isArray(patient)) {
    const first = patient[0];
    return first && typeof first === "object"
      ? (first as {
          full_name_ar?: string | null;
          phone?: string | null;
          phone_number?: string | null;
        })
      : null;
  }
  if (typeof patient === "object") {
    return patient as {
      full_name_ar?: string | null;
      phone?: string | null;
      phone_number?: string | null;
    };
  }
  return null;
}

function resolveAppointmentPatientFields(row: Record<string, unknown>): {
  patient_name_ar: string | null;
  patient_phone: string | null;
} {
  const patient = unwrapPatient(row.patient);
  const joinedName = patient?.full_name_ar?.trim();
  const joinedPhone = patient
    ? getPatientDisplayPhone(patient)
    : null;

  return {
    patient_name_ar:
      joinedName ||
      (row.patient_name_ar != null ? String(row.patient_name_ar) : null),
    patient_phone:
      joinedPhone ||
      (row.patient_phone != null ? String(row.patient_phone) : null),
  };
}

export function normalizeAppointmentRow(
  row: Record<string, unknown>
): AppointmentWithDoctor {
  const patientFields = resolveAppointmentPatientFields(row);
  const normalized = {
    ...(row as unknown as AppointmentWithDoctor),
    appointment_date: String(row.appointment_date ?? ""),
    start_time: String(row.start_time ?? ""),
    end_time: String(row.end_time ?? ""),
    patient_name_ar: patientFields.patient_name_ar,
    patient_phone: patientFields.patient_phone,
    notes: row.notes != null ? String(row.notes) : null,
    reason_for_change:
      row.reason_for_change != null ? String(row.reason_for_change) : null,
    status: String(row.status ?? "scheduled") as AppointmentWithDoctor["status"],
    doctor: unwrapDoctor(row.doctor),
  };
  delete (normalized as Record<string, unknown>).patient;
  return normalized;
}

export function normalizeAppointmentRows(
  rows: Record<string, unknown>[] | null | undefined
): AppointmentWithDoctor[] {
  return (rows ?? []).flatMap((row) => {
    try {
      return [normalizeAppointmentRow(row)];
    } catch (err) {
      console.error("[appointments] skip invalid row", err, row);
      return [];
    }
  });
}
