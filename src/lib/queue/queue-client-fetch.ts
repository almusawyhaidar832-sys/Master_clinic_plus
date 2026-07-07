"use client";

import type { AppSupabaseClient } from "@/lib/supabase/app-client";
import { todayIsoDate } from "@/lib/queue/realtime-patch";

const QUEUE_ENTRY_SELECT = `
  id, ticket_number, status, patient_name, patient_phone,
  patient_id, doctor_id, clinic_id, created_at, called_at, entered_at,
  sent_to_doctor_at, appointment_id,
  transfer_to_doctor_id, transfer_from_doctor_id, transfer_requested_at,
  cancellation_requested_at, cancellation_requested_by, cancellation_actor_label,
  notes, doctor_notes,
  doctor:doctors!doctor_id(full_name_ar),
  transfer_to_doctor:doctors!transfer_to_doctor_id(full_name_ar),
  patient:patients(full_name_ar, speech_name_ar, gender)
`;

export interface ClinicDoctorRow {
  id: string;
  full_name_ar: string;
  specialty_ar: string | null;
}

/** تحميل طابور اليوم من Supabase مباشرة — بدون GET /api/queue */
export async function fetchTodayQueueFromSupabase<T = Record<string, unknown>>(
  supabase: AppSupabaseClient,
  opts: {
    clinicId: string;
    doctorId?: string;
    includeDone?: boolean;
    excludeCancellationPending?: boolean;
  }
): Promise<T[]> {
  const today = todayIsoDate();

  let query = supabase
    .from("patient_queue")
    .select(QUEUE_ENTRY_SELECT)
    .eq("clinic_id", opts.clinicId)
    .eq("queue_date", today)
    .neq("status", "cancelled")
    .order("ticket_number", { ascending: true });

  if (opts.doctorId) {
    query = query.eq("doctor_id", opts.doctorId).is("cancellation_requested_at", null);
  } else if (opts.excludeCancellationPending) {
    query = query.is("cancellation_requested_at", null);
  }

  if (!opts.includeDone) {
    query = query.neq("status", "done");
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []) as T[];
}

export async function fetchClinicDoctorsFromSupabase(
  supabase: AppSupabaseClient,
  clinicId: string
): Promise<ClinicDoctorRow[]> {
  const { data, error } = await supabase
    .from("doctors")
    .select("id, full_name_ar, specialty_ar")
    .eq("clinic_id", clinicId)
    .eq("is_active", true);

  if (error) throw new Error(error.message);
  return (data ?? []) as ClinicDoctorRow[];
}
