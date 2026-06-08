import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { AppointmentStatus } from "@/types";
import {
  insertQueueEntry,
  notifyDoctorNewQueuePatient,
  type QueueStatus,
} from "@/lib/queue/server";

function todayIsoDate() {
  return new Date().toISOString().split("T")[0];
}

const QUEUE_TO_APPOINTMENT: Partial<Record<QueueStatus, AppointmentStatus>> = {
  waiting: "waiting",
  called: "waiting",
  in_progress: "in_clinic",
  done: "completed",
  cancelled: "cancelled",
};

/** بعد الموافقة على طلب الباركود — waiting + إدراج في غرفة الانتظار */
export async function enqueueApprovedAppointment(
  admin: SupabaseClient,
  appointment: {
    id: string;
    clinic_id: string;
    doctor_id: string;
    patient_name_ar: string | null;
    patient_phone: string | null;
    patient_id?: string | null;
  }
): Promise<string> {
  const today = todayIsoDate();

  const { data: existing } = await admin
    .from("patient_queue")
    .select("id")
    .eq("appointment_id", appointment.id)
    .eq("queue_date", today)
    .neq("status", "cancelled")
    .maybeSingle();

  if (existing?.id) return existing.id as string;

  const queueId = await insertQueueEntry({
    clinic_id: appointment.clinic_id,
    doctor_id: appointment.doctor_id,
    patient_name: appointment.patient_name_ar,
    patient_phone: appointment.patient_phone,
    patient_id: appointment.patient_id ?? null,
    appointment_id: appointment.id,
    source: "online",
    send_to_doctor: true,
  });

  return queueId;
}

/** مزامنة حالة الموعد عند تغيّر دور الانتظار */
export async function syncAppointmentFromQueueStatus(
  admin: SupabaseClient,
  queueEntryId: string,
  queueStatus: QueueStatus
): Promise<void> {
  const nextAppointmentStatus = QUEUE_TO_APPOINTMENT[queueStatus];
  if (!nextAppointmentStatus) return;

  const { data: entry } = await admin
    .from("patient_queue")
    .select("appointment_id, clinic_id")
    .eq("id", queueEntryId)
    .maybeSingle();

  if (!entry?.appointment_id) return;

  const { error } = await admin
    .from("appointments")
    .update({ status: nextAppointmentStatus })
    .eq("id", entry.appointment_id)
    .eq("clinic_id", entry.clinic_id);

  if (error) {
    if (
      queueStatus === "in_progress" &&
      nextAppointmentStatus === "in_clinic" &&
      (error.message.includes("in_clinic") ||
        error.message.includes("invalid input value"))
    ) {
      const { error: retryErr } = await admin
        .from("appointments")
        .update({ status: "in_examination" })
        .eq("id", entry.appointment_id)
        .eq("clinic_id", entry.clinic_id);
      if (retryErr) {
        console.error(
          "[appointment-queue-sync] in_examination fallback failed:",
          retryErr.message
        );
      }
      return;
    }

    console.error("[appointment-queue-sync] appointment update failed:", error.message);
  }
}

/** مزامنة دور الانتظار عند تغيّر حالة الموعد (دخول للعيادة) */
export async function syncQueueFromAppointmentStatus(
  admin: SupabaseClient,
  appointmentId: string,
  clinicId: string,
  appointmentStatus: AppointmentStatus
): Promise<void> {
  const today = todayIsoDate();

  const { data: entry } = await admin
    .from("patient_queue")
    .select("id, status")
    .eq("appointment_id", appointmentId)
    .eq("clinic_id", clinicId)
    .eq("queue_date", today)
    .neq("status", "cancelled")
    .neq("status", "done")
    .maybeSingle();

  if (!entry?.id) return;

  let nextQueueStatus: QueueStatus | null = null;

  if (appointmentStatus === "in_clinic" || appointmentStatus === "in_examination") {
    nextQueueStatus = "in_progress";
  } else if (appointmentStatus === "completed") {
    nextQueueStatus = "done";
  } else if (appointmentStatus === "cancelled") {
    nextQueueStatus = "cancelled";
  } else if (appointmentStatus === "waiting") {
    nextQueueStatus = "waiting";
  }

  if (!nextQueueStatus || nextQueueStatus === entry.status) return;

  const { error } = await admin
    .from("patient_queue")
    .update({ status: nextQueueStatus })
    .eq("id", entry.id);

  if (error) {
    console.error("[appointment-queue-sync] queue update failed:", error.message);
  }
}

/** إشعار الطبيب عند إدراج مراجع من موعد معتمد */
export async function notifyDoctorForApprovedAppointment(
  queueEntryId: string
): Promise<void> {
  await notifyDoctorNewQueuePatient(queueEntryId).catch((err) => {
    console.error("[appointment-queue-sync] doctor notify failed:", err);
  });
}
