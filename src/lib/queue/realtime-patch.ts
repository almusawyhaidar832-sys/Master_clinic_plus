import type { RealtimePostgresChangesPayload } from "@supabase/supabase-js";

export type QueueRealtimePayload = RealtimePostgresChangesPayload<
  Record<string, unknown>
>;

export function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

export function isTodayQueueRow(row: Record<string, unknown> | null | undefined): boolean {
  if (!row) return false;
  const queueDate = row.queue_date;
  if (queueDate == null || queueDate === "") return true;
  return String(queueDate) === todayIsoDate();
}

type DoctorLookup = { id: string; full_name_ar: string };

function resolveDoctorFromLookup(
  doctorId: string | undefined,
  doctors?: DoctorLookup[],
  existing?: { full_name_ar: string } | null
): { full_name_ar: string } | null {
  if (existing?.full_name_ar) return existing;
  if (!doctorId || !doctors?.length) return existing ?? null;
  const match = doctors.find((d) => d.id === doctorId);
  return match ? { full_name_ar: match.full_name_ar } : existing ?? null;
}

/** Merge a flat realtime row into an existing queue entry (preserves joins). */
export function mergeRealtimeQueueRow<T extends { id: string }>(
  existing: T | undefined,
  row: Record<string, unknown>,
  doctors?: DoctorLookup[]
): T {
  const doctorId = String(row.doctor_id ?? (existing as { doctor_id?: string })?.doctor_id ?? "");
  const patientName =
    row.patient_name != null
      ? String(row.patient_name)
      : (existing as { patient_name?: string | null })?.patient_name ?? null;

  const merged = {
    ...(existing ?? {}),
    id: String(row.id),
    ticket_number: Number(
      row.ticket_number ?? (existing as { ticket_number?: number })?.ticket_number ?? 0
    ),
    status: String(row.status ?? (existing as { status?: string })?.status ?? "waiting"),
    patient_name: patientName,
    patient_phone:
      row.patient_phone != null
        ? String(row.patient_phone)
        : (existing as { patient_phone?: string | null })?.patient_phone ?? null,
    patient_id:
      row.patient_id != null
        ? String(row.patient_id)
        : (existing as { patient_id?: string | null })?.patient_id ?? null,
    doctor_id: doctorId,
    clinic_id: String(
      row.clinic_id ?? (existing as { clinic_id?: string })?.clinic_id ?? ""
    ),
    created_at: String(
      row.created_at ?? (existing as { created_at?: string })?.created_at ?? ""
    ),
    called_at:
      row.called_at != null
        ? String(row.called_at)
        : (existing as { called_at?: string | null })?.called_at ?? null,
    entered_at:
      row.entered_at != null
        ? String(row.entered_at)
        : (existing as { entered_at?: string | null })?.entered_at ?? null,
    sent_to_doctor_at:
      row.sent_to_doctor_at != null
        ? String(row.sent_to_doctor_at)
        : (existing as { sent_to_doctor_at?: string | null })?.sent_to_doctor_at ?? null,
    appointment_id:
      row.appointment_id != null
        ? String(row.appointment_id)
        : (existing as { appointment_id?: string | null })?.appointment_id ?? null,
    transfer_to_doctor_id:
      row.transfer_to_doctor_id != null
        ? String(row.transfer_to_doctor_id)
        : (existing as { transfer_to_doctor_id?: string | null })?.transfer_to_doctor_id ??
          null,
    transfer_from_doctor_id:
      row.transfer_from_doctor_id != null
        ? String(row.transfer_from_doctor_id)
        : (existing as { transfer_from_doctor_id?: string | null })
            ?.transfer_from_doctor_id ?? null,
    transfer_requested_at:
      row.transfer_requested_at != null
        ? String(row.transfer_requested_at)
        : (existing as { transfer_requested_at?: string | null })
            ?.transfer_requested_at ?? null,
    cancellation_requested_at:
      row.cancellation_requested_at != null
        ? String(row.cancellation_requested_at)
        : (existing as { cancellation_requested_at?: string | null })
            ?.cancellation_requested_at ?? null,
    cancellation_requested_by:
      row.cancellation_requested_by != null
        ? String(row.cancellation_requested_by)
        : (existing as { cancellation_requested_by?: string | null })
            ?.cancellation_requested_by ?? null,
    cancellation_actor_label:
      row.cancellation_actor_label != null
        ? String(row.cancellation_actor_label)
        : (existing as { cancellation_actor_label?: string | null })
            ?.cancellation_actor_label ?? null,
    notes:
      row.notes != null
        ? String(row.notes)
        : (existing as { notes?: string | null })?.notes ?? null,
    doctor_notes:
      row.doctor_notes != null
        ? String(row.doctor_notes)
        : (existing as { doctor_notes?: string | null })?.doctor_notes ?? null,
    doctor: resolveDoctorFromLookup(
      doctorId,
      doctors,
      (existing as { doctor?: { full_name_ar: string } | null })?.doctor
    ),
    patient:
      (existing as { patient?: { full_name_ar: string } | null })?.patient ??
      (patientName ? { full_name_ar: patientName } : null),
  };

  return merged as unknown as T;
}

function sortByTicket<T extends { ticket_number: number }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => a.ticket_number - b.ticket_number);
}

export interface PatchQueueListOptions<T extends { id: string; ticket_number: number }> {
  doctors?: DoctorLookup[];
  /** Return false to drop the row from the list */
  includeRow?: (row: Record<string, unknown>) => boolean;
  /** When set, only rows for this doctor are kept */
  doctorId?: string;
}

/**
 * Apply a patient_queue realtime event to a local queue array — no API refetch.
 */
export function patchQueueListFromRealtime<T extends { id: string; ticket_number: number }>(
  current: T[],
  payload: QueueRealtimePayload,
  options?: PatchQueueListOptions<T>
): T[] {
  const eventType = payload.eventType;
  const oldRow = payload.old as Record<string, unknown> | undefined;
  const newRow = payload.new as Record<string, unknown> | undefined;
  const row = newRow ?? oldRow;

  if (!row && eventType !== "DELETE") return current;

  if (eventType === "DELETE") {
    const id = String(oldRow?.id ?? "");
    return id ? current.filter((entry) => entry.id !== id) : current;
  }

  if (!isTodayQueueRow(row)) return current;

  const entryId = String(row!.id);
  const filterDoctorId = options?.doctorId;

  if (filterDoctorId) {
    const rowDoctorId = String(row!.doctor_id ?? "");
    if (rowDoctorId !== filterDoctorId) {
      if (eventType === "UPDATE" && String(oldRow?.doctor_id ?? "") === filterDoctorId) {
        return current.filter((entry) => entry.id !== entryId);
      }
      return current;
    }
  }

  const include =
    options?.includeRow?.(row!) ??
    !["cancelled"].includes(String(row!.status ?? ""));

  const existing = current.find((entry) => entry.id === entryId);

  if (!include) {
    return current.filter((entry) => entry.id !== entryId);
  }

  const patched = mergeRealtimeQueueRow(existing, row!, options?.doctors);

  if (eventType === "INSERT") {
    if (existing) {
      return sortByTicket(
        current.map((entry) => (entry.id === entryId ? patched : entry))
      );
    }
    return sortByTicket([...current, patched]);
  }

  return sortByTicket(
    current.map((entry) => (entry.id === entryId ? patched : entry))
  );
}
