import { getAdminClient } from "@/lib/supabase/admin";
import { resolveDoctorProfileId, insertNotifications } from "@/lib/notifications/server";
import { resolvePatientDisplayName } from "@/lib/queue/utils";

export type QueueStatus =
  | "waiting"
  | "called"
  | "in_progress"
  | "ready_for_payment"
  | "done"
  | "cancelled";

export interface QueueEntryRow {
  id: string;
  ticket_number: number;
  status: QueueStatus;
  patient_name: string | null;
  patient_phone: string | null;
  patient_id: string | null;
  doctor_id: string;
  clinic_id: string;
  created_at: string;
  called_at: string | null;
  entered_at: string | null;
  sent_to_doctor_at: string | null;
  appointment_id: string | null;
  doctor: { full_name_ar: string } | null;
  patient: { full_name_ar: string } | null;
}

function todayIsoDate() {
  return new Date().toISOString().split("T")[0];
}

/** Fetch today's queue for a clinic (optionally filtered by doctor) */
export async function fetchClinicQueue(
  clinicId: string,
  opts?: { doctorId?: string; includeDone?: boolean }
) {
  const admin = getAdminClient();
  const today = todayIsoDate();

  let query = admin
    .from("patient_queue")
    .select(
      `
      id, ticket_number, status, patient_name, patient_phone,
      patient_id, doctor_id, clinic_id, created_at, called_at, entered_at,
      sent_to_doctor_at, appointment_id,
      doctor:doctors(full_name_ar),
      patient:patients(full_name_ar)
    `
    )
    .eq("clinic_id", clinicId)
    .eq("queue_date", today)
    .neq("status", "cancelled")
    .order("ticket_number", { ascending: true });

  if (opts?.doctorId) {
    query = query.eq("doctor_id", opts.doctorId);
  }

  if (!opts?.includeDone) {
    query = query.neq("status", "done");
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as QueueEntryRow[];
}

/** Notify assigned doctor: new patient in queue */
export async function notifyDoctorNewQueuePatient(queueEntryId: string) {
  const admin = getAdminClient();

  const { data: entry, error } = await admin
    .from("patient_queue")
    .select(
      "id, clinic_id, doctor_id, patient_name, ticket_number, patient_id, patient:patients(full_name_ar)"
    )
    .eq("id", queueEntryId)
    .maybeSingle();

  if (error || !entry) throw new Error("queue entry not found");

  const profileId = await resolveDoctorProfileId(
    admin,
    entry.doctor_id,
    entry.clinic_id
  );
  if (!profileId) return;

  const patientRow = entry.patient as { full_name_ar?: string } | null;
  const name = resolvePatientDisplayName({
    patient: patientRow ? { full_name_ar: patientRow.full_name_ar ?? "" } : null,
    patient_name: entry.patient_name,
    ticket_number: entry.ticket_number,
  });

  await insertNotifications([
    {
      clinic_id: entry.clinic_id,
      recipient_profile_id: profileId,
      title_ar: "مراجع جديد في الانتظار",
      body_ar: `لديك مراجع جديد في الانتظار: ${name}`,
      link_path: "/doctor/queue",
    },
  ]);
}

/** Notify accountants: patient ready for checkout after doctor session */
export async function notifyAccountantsReadyForPayment(queueEntryId: string) {
  const admin = getAdminClient();

  const { data: entry, error } = await admin
    .from("patient_queue")
    .select(
      "id, clinic_id, patient_name, ticket_number, patient_id, patient:patients(full_name_ar)"
    )
    .eq("id", queueEntryId)
    .maybeSingle();

  if (error || !entry) return;

  const { data: staff } = await admin
    .from("profiles")
    .select("id")
    .eq("clinic_id", entry.clinic_id)
    .in("role", ["accountant", "super_admin"]);

  if (!staff?.length) return;

  const patientRow = entry.patient as { full_name_ar?: string } | null;
  const name = resolvePatientDisplayName({
    patient: patientRow ? { full_name_ar: patientRow.full_name_ar ?? "" } : null,
    patient_name: entry.patient_name,
    ticket_number: entry.ticket_number,
  });

  await insertNotifications(
    staff.map((s) => ({
      clinic_id: entry.clinic_id,
      recipient_profile_id: s.id,
      title_ar: "جاهز للدفع",
      body_ar: `المراجع ${name} — أنهى الطبيب الجلسة، أكمل الحساب الآن`,
      link_path: "/dashboard/queue",
    }))
  );
}

/** Notify accountants: doctor ready for patient to enter */
export async function notifyAccountantsPatientAdmit(queueEntryId: string) {
  const admin = getAdminClient();

  const { data: entry, error } = await admin
    .from("patient_queue")
    .select(
      "id, clinic_id, patient_name, ticket_number, patient_id, patient:patients(full_name_ar)"
    )
    .eq("id", queueEntryId)
    .maybeSingle();

  if (error || !entry) throw new Error("queue entry not found");

  const { data: staff } = await admin
    .from("profiles")
    .select("id")
    .eq("clinic_id", entry.clinic_id)
    .in("role", ["accountant", "super_admin"]);

  if (!staff?.length) return;

  const patientRow = entry.patient as { full_name_ar?: string } | null;
  const name = resolvePatientDisplayName({
    patient: patientRow ? { full_name_ar: patientRow.full_name_ar ?? "" } : null,
    patient_name: entry.patient_name,
    ticket_number: entry.ticket_number,
  });

  await insertNotifications(
    staff.map((s) => ({
      clinic_id: entry.clinic_id,
      recipient_profile_id: s.id,
      title_ar: "ادخل المراجع للعيادة",
      body_ar: `المراجع ${name} — يُرجى دخوله للعيادة الآن`,
      link_path: "/dashboard/queue",
    }))
  );
}

/** Mark entry as sent to doctor + persist notification */
export async function sendQueueEntryToDoctor(
  queueEntryId: string,
  force = false
) {
  const admin = getAdminClient();
  const now = new Date().toISOString();

  let query = admin
    .from("patient_queue")
    .update({ sent_to_doctor_at: now })
    .eq("id", queueEntryId);

  if (!force) {
    query = query.is("sent_to_doctor_at", null);
  }

  const { error } = await query;
  if (error) throw new Error(error.message);

  await notifyDoctorNewQueuePatient(queueEntryId).catch((err) => {
    console.error("[queue] doctor notification failed:", err);
  });
}

/** Re-notify accountants: doctor requests patient entry again */
export async function recallAccountantNotification(queueEntryId: string) {
  await notifyAccountantsPatientAdmit(queueEntryId).catch((err) => {
    console.error("[queue] accountant recall failed:", err);
  });
}

export async function insertQueueEntry(input: {
  clinic_id: string;
  doctor_id: string;
  patient_name?: string | null;
  patient_phone?: string | null;
  patient_id?: string | null;
  appointment_id?: string | null;
  source?: "walk_in" | "appointment" | "online";
  send_to_doctor?: boolean;
}) {
  const admin = getAdminClient();
  const today = todayIsoDate();

  const { data, error } = await admin
    .from("patient_queue")
    .insert({
      clinic_id: input.clinic_id,
      doctor_id: input.doctor_id,
      patient_name: input.patient_name?.trim() || null,
      patient_phone: input.patient_phone?.trim() || null,
      patient_id: input.patient_id ?? null,
      appointment_id: input.appointment_id ?? null,
      queue_date: today,
      status: "waiting",
      source: input.source ?? "walk_in",
      sent_to_doctor_at: input.send_to_doctor ? new Date().toISOString() : null,
    })
    .select("id")
    .single();

  if (error) throw new Error(error.message);

  if (input.send_to_doctor && data?.id) {
    await notifyDoctorNewQueuePatient(data.id).catch((err) => {
      console.error("[queue] doctor notification on insert failed:", err);
    });
  }

  return data.id as string;
}

export async function updateQueueStatus(
  queueEntryId: string,
  status: QueueStatus,
  opts?: { clinicId?: string; doctorId?: string }
) {
  const admin = getAdminClient();

  let query = admin
    .from("patient_queue")
    .update({ status })
    .eq("id", queueEntryId);

  if (opts?.clinicId) query = query.eq("clinic_id", opts.clinicId);
  if (opts?.doctorId) query = query.eq("doctor_id", opts.doctorId);

  const { data, error } = await query.select("id").maybeSingle();
  if (error) {
    if (
      status === "ready_for_payment" &&
      (error.message.includes("ready_for_payment") ||
        error.message.includes("invalid input value"))
    ) {
      throw new Error(
        "حالة ready_for_payment غير موجودة — شغّل supabase/scripts/16-queue-checkout-flow.sql"
      );
    }
    throw new Error(error.message);
  }
  if (!data) {
    throw new Error("لم يتم تحديث الدور — تحقق من الصلاحيات أو حالة المراجع");
  }
}

export async function getDoctorByProfileId(profileId: string) {
  const admin = getAdminClient();
  const { data } = await admin
    .from("doctors")
    .select("id, clinic_id, full_name_ar, profile_id")
    .eq("profile_id", profileId)
    .eq("is_active", true)
    .maybeSingle();
  return data;
}
