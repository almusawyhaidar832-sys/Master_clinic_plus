import { getAdminClient } from "@/lib/supabase/admin";
import { resolveDoctorProfileId, insertNotifications } from "@/lib/notifications/server";
import { sendWebPushToProfile } from "@/lib/push/server";
import { resolvePatientDisplayName } from "@/lib/queue/utils";

export type QueueStatus =
  | "waiting"
  | "called"
  | "in_progress"
  | "ready_for_billing"
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
  transfer_to_doctor_id: string | null;
  transfer_from_doctor_id: string | null;
  transfer_requested_at: string | null;
  doctor: { full_name_ar: string } | null;
  transfer_to_doctor?: { full_name_ar: string } | null;
  patient: { full_name_ar: string } | null;
}

const QUEUE_ENTRY_SELECT = `
  id, ticket_number, status, patient_name, patient_phone,
  patient_id, doctor_id, clinic_id, created_at, called_at, entered_at,
  sent_to_doctor_at, appointment_id,
  transfer_to_doctor_id, transfer_from_doctor_id, transfer_requested_at,
  doctor:doctors!doctor_id(full_name_ar),
  transfer_to_doctor:doctors!transfer_to_doctor_id(full_name_ar),
  patient:patients(full_name_ar, speech_name_ar)
`;

async function loadQueueEntryContext(queueEntryId: string) {
  const admin = getAdminClient();
  const { data, error } = await admin
    .from("patient_queue")
    .select(QUEUE_ENTRY_SELECT)
    .eq("id", queueEntryId)
    .maybeSingle();

  if (error || !data) {
    throw new Error("queue entry not found");
  }

  return data as unknown as QueueEntryRow;
}

async function fetchDoctorNameById(
  admin: ReturnType<typeof getAdminClient>,
  doctorId: string
): Promise<string> {
  const { data } = await admin
    .from("doctors")
    .select("full_name_ar")
    .eq("id", doctorId)
    .maybeSingle();
  return String(data?.full_name_ar ?? "طبيب");
}

function resolveQueuePatientName(entry: QueueEntryRow): string {
  const patientRow = entry.patient as { full_name_ar?: string } | null;
  return resolvePatientDisplayName({
    patient: patientRow ? { full_name_ar: patientRow.full_name_ar ?? "" } : null,
    patient_name: entry.patient_name,
    ticket_number: entry.ticket_number,
  });
}

async function notifyAccountantProfiles(
  clinicId: string,
  payload: { title_ar: string; body_ar: string; link_path: string }
) {
  const admin = getAdminClient();
  const { data: staff } = await admin
    .from("profiles")
    .select("id")
    .eq("clinic_id", clinicId)
    .in("role", ["accountant", "super_admin"]);

  if (!staff?.length) return;

  await insertNotifications(
    staff.map((s) => ({
      clinic_id: clinicId,
      recipient_profile_id: s.id,
      title_ar: payload.title_ar,
      body_ar: payload.body_ar,
      link_path: payload.link_path,
    }))
  );
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
    .select(QUEUE_ENTRY_SELECT)
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

/** Notify assigned doctor: new patient in queue (or accountant recall) */
export async function notifyDoctorNewQueuePatient(
  queueEntryId: string,
  options?: { recall?: boolean }
) {
  const admin = getAdminClient();

  const { data: entry, error } = await admin
    .from("patient_queue")
    .select(
      "id, clinic_id, doctor_id, patient_name, ticket_number, patient_id, patient:patients(full_name_ar, speech_name_ar)"
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

  const recall = options?.recall === true;
  const titleAr = recall
    ? "تذكير — مراجع في الانتظار"
    : "مراجع جديد في الانتظار";
  const bodyAr = recall
    ? `تذكير: المراجع ${name} بانتظارك — يرجى استقباله`
    : `لديك مراجع جديد في الانتظار: ${name}`;

  await insertNotifications([
    {
      clinic_id: entry.clinic_id,
      recipient_profile_id: profileId,
      title_ar: titleAr,
      body_ar: bodyAr,
      link_path: "/doctor/queue",
    },
  ]);

  await sendWebPushToProfile(profileId, {
    title: recall ? "تذكير — مراجع 🔔" : "مراجع جديد 🔔",
    body: bodyAr,
    url: "/doctor/queue",
    tag: recall
      ? `doctor-recall-${entry.id}-${Date.now()}`
      : `doctor-queue-${entry.id}`,
    patientName: name,
  }).catch((err) => {
    console.error("[queue] doctor web push failed:", err);
  });
}

/** Notify accountants: doctor sent session for billing */
export async function notifyAccountantsReadyForBilling(queueEntryId: string) {
  const admin = getAdminClient();

  const { data: entry, error } = await admin
    .from("patient_queue")
    .select(
      "id, clinic_id, patient_name, ticket_number, patient_id, patient:patients(full_name_ar, speech_name_ar)"
    )
    .eq("id", queueEntryId)
    .maybeSingle();

  if (error || !entry) return;

  const { data: staff } = await admin
    .from("profiles")
    .select("id")
    .eq("clinic_id", entry.clinic_id)
    .in("role", ["accountant", "super_admin", "assistant"]);

  if (!staff?.length) return;

  const patientRow = entry.patient as { full_name_ar?: string } | null;
  const name = resolvePatientDisplayName({
    patient: patientRow ? { full_name_ar: patientRow.full_name_ar ?? "" } : null,
    patient_name: entry.patient_name,
    ticket_number: entry.ticket_number,
  });

  const ledgerPath = `/dashboard/ledger?queue_entry_id=${entry.id}`;

  await insertNotifications(
    staff.map((s) => ({
      clinic_id: entry.clinic_id,
      recipient_profile_id: s.id,
      title_ar: "جلسة جاهزة للمحاسبة",
      body_ar: `المراجع ${name} — أُرسلت الجلسة من الطبيب، أكمل الفاتورة`,
      link_path: ledgerPath,
    }))
  );
}

/** Notify accountants: patient ready for checkout after doctor session */
export async function notifyAccountantsReadyForPayment(queueEntryId: string) {
  const admin = getAdminClient();

  const { data: entry, error } = await admin
    .from("patient_queue")
    .select(
      "id, clinic_id, patient_name, ticket_number, patient_id, patient:patients(full_name_ar, speech_name_ar)"
    )
    .eq("id", queueEntryId)
    .maybeSingle();

  if (error || !entry) return;

  const { data: staff } = await admin
    .from("profiles")
    .select("id")
    .eq("clinic_id", entry.clinic_id)
    .in("role", ["accountant", "super_admin", "assistant"]);

  if (!staff?.length) return;

  const patientRow = entry.patient as { full_name_ar?: string } | null;
  const name = resolvePatientDisplayName({
    patient: patientRow ? { full_name_ar: patientRow.full_name_ar ?? "" } : null,
    patient_name: entry.patient_name,
    ticket_number: entry.ticket_number,
  });

  const ledgerPath = `/dashboard/ledger?queue_entry_id=${entry.id}`;

  await insertNotifications(
    staff.map((s) => ({
      clinic_id: entry.clinic_id,
      recipient_profile_id: s.id,
      title_ar: "جاهز للدفع",
      body_ar: `المراجع ${name} — الجلسة جاهزة، أكمل الحساب الآن`,
      link_path: ledgerPath,
    }))
  );
}

/** Notify accountants: doctor ready for patient to enter */
export async function notifyAccountantsPatientAdmit(queueEntryId: string) {
  const admin = getAdminClient();

  const { data: entry, error } = await admin
    .from("patient_queue")
    .select(
      "id, clinic_id, patient_name, ticket_number, patient_id, patient:patients(full_name_ar, speech_name_ar)"
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

  await notifyDoctorNewQueuePatient(queueEntryId, { recall: force }).catch((err) => {
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

  const entryId = data.id as string;

  if (!input.patient_id && entryId) {
    const hasIdentity =
      Boolean(input.patient_name?.trim()) || Boolean(input.patient_phone?.trim());
    if (hasIdentity) {
      const { ensureQueueEntryPatient } = await import(
        "@/lib/services/ensure-queue-entry-patient"
      );
      await ensureQueueEntryPatient(admin, entryId, input.clinic_id).catch((err) => {
        console.error("[queue] auto-link patient on insert failed:", err);
      });
    }
  }

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
      (status === "ready_for_payment" || status === "ready_for_billing") &&
      (error.message.includes("ready_for_payment") ||
        error.message.includes("ready_for_billing") ||
        error.message.includes("invalid input value"))
    ) {
      throw new Error(
        status === "ready_for_billing"
          ? "حالة ready_for_billing غير موجودة — شغّل supabase/scripts/31-ready-for-billing.sql"
          : "حالة ready_for_payment غير موجودة — شغّل supabase/scripts/16-queue-checkout-flow.sql"
      );
    }
    throw new Error(error.message);
  }
  if (!data) {
    throw new Error("لم يتم تحديث الدور — تحقق من الصلاحيات أو حالة المراجع");
  }
}

const DOCTOR_QUEUE_ACTION_STATUSES: QueueStatus[] = ["waiting", "called"];

/** رفض الطبيب للمراجع — إلغاء فوري + إشعار المحاسب (بدون شاشة النداء) */
export async function rejectQueueEntryByDoctor(
  queueEntryId: string,
  doctorId: string
) {
  const admin = getAdminClient();
  const entry = await loadQueueEntryContext(queueEntryId);

  if (entry.doctor_id !== doctorId) {
    throw new Error("غير مصرح");
  }
  if (!DOCTOR_QUEUE_ACTION_STATUSES.includes(entry.status)) {
    throw new Error("لا يمكن الرفض في هذه المرحلة");
  }

  const doctorName = await fetchDoctorNameById(admin, doctorId);
  const patientName = resolveQueuePatientName(entry);

  const { error } = await admin
    .from("patient_queue")
    .update({
      status: "cancelled",
      transfer_to_doctor_id: null,
      transfer_from_doctor_id: null,
      transfer_requested_at: null,
    })
    .eq("id", queueEntryId)
    .eq("doctor_id", doctorId)
    .in("status", DOCTOR_QUEUE_ACTION_STATUSES);

  if (error) throw new Error(error.message);

  await notifyAccountantProfiles(entry.clinic_id, {
    title_ar: "رفض الطبيب للمراجع",
    body_ar: `الطبيب ${doctorName} رفض المراجع ${patientName} — تم إلغاء الدور`,
    link_path: "/dashboard/queue",
  });
}

/** طلب تحويل مراجع لطبيب آخر — بانتظار تأكيد المحاسب */
export async function requestQueueTransferByDoctor(
  queueEntryId: string,
  doctorId: string,
  targetDoctorId: string
) {
  const admin = getAdminClient();
  const entry = await loadQueueEntryContext(queueEntryId);

  if (entry.doctor_id !== doctorId) {
    throw new Error("غير مصرح");
  }
  if (!DOCTOR_QUEUE_ACTION_STATUSES.includes(entry.status)) {
    throw new Error("لا يمكن التحويل في هذه المرحلة");
  }
  if (targetDoctorId === doctorId) {
    throw new Error("اختر طبيباً غيرك");
  }

  const { data: target } = await admin
    .from("doctors")
    .select("id, full_name_ar, clinic_id, is_active")
    .eq("id", targetDoctorId)
    .maybeSingle();

  if (!target || target.clinic_id !== entry.clinic_id || !target.is_active) {
    throw new Error("الطبيب المستهدف غير متاح");
  }

  const fromName = await fetchDoctorNameById(admin, doctorId);
  const toName = String(target.full_name_ar ?? "طبيب");
  const patientName = resolveQueuePatientName(entry);
  const now = new Date().toISOString();

  const { error } = await admin
    .from("patient_queue")
    .update({
      transfer_to_doctor_id: targetDoctorId,
      transfer_from_doctor_id: doctorId,
      transfer_requested_at: now,
    })
    .eq("id", queueEntryId)
    .eq("doctor_id", doctorId)
    .in("status", DOCTOR_QUEUE_ACTION_STATUSES)
    .is("transfer_to_doctor_id", null);

  if (error) throw new Error(error.message);

  await notifyAccountantProfiles(entry.clinic_id, {
    title_ar: "طلب تحويل مراجع",
    body_ar: `الطبيب ${fromName} يطلب تحويل ${patientName} إلى ${toName}`,
    link_path: "/dashboard/queue",
  });
}

/** تأكيد المحاسب لتحويل المراجع لطبيب جديد */
export async function confirmQueueTransferByAccountant(
  queueEntryId: string,
  clinicId: string
) {
  const admin = getAdminClient();
  const entry = await loadQueueEntryContext(queueEntryId);

  if (entry.clinic_id !== clinicId) {
    throw new Error("غير مصرح");
  }
  if (!entry.transfer_to_doctor_id) {
    throw new Error("لا يوجد طلب تحويل لهذا الدور");
  }
  if (!DOCTOR_QUEUE_ACTION_STATUSES.includes(entry.status)) {
    throw new Error("لا يمكن إتمام التحويل في هذه المرحلة");
  }

  const fromDoctorId = entry.transfer_from_doctor_id ?? entry.doctor_id;
  const toDoctorId = entry.transfer_to_doctor_id;
  const fromName = await fetchDoctorNameById(admin, fromDoctorId);
  const patientName = resolveQueuePatientName(entry);
  const now = new Date().toISOString();

  const { error } = await admin
    .from("patient_queue")
    .update({
      doctor_id: toDoctorId,
      status: "waiting",
      called_at: null,
      sent_to_doctor_at: now,
      transfer_to_doctor_id: null,
      transfer_from_doctor_id: null,
      transfer_requested_at: null,
    })
    .eq("id", queueEntryId)
    .eq("clinic_id", clinicId);

  if (error) throw new Error(error.message);

  if (entry.appointment_id) {
    await admin
      .from("appointments")
      .update({ doctor_id: toDoctorId })
      .eq("id", entry.appointment_id)
      .eq("clinic_id", clinicId);
  }

  const profileId = await resolveDoctorProfileId(admin, toDoctorId, clinicId);
  if (profileId) {
    await insertNotifications([
      {
        clinic_id: clinicId,
        recipient_profile_id: profileId,
        title_ar: "حالة محوّلة إليك",
        body_ar: `المراجع ${patientName} — حوّلها إليك الطبيب ${fromName}`,
        link_path: "/doctor/queue",
      },
    ]);
  }

}

/** إلغاء طلب التحويل من المحاسب */
export async function dismissQueueTransferRequest(
  queueEntryId: string,
  clinicId: string
) {
  const admin = getAdminClient();
  const { error } = await admin
    .from("patient_queue")
    .update({
      transfer_to_doctor_id: null,
      transfer_from_doctor_id: null,
      transfer_requested_at: null,
    })
    .eq("id", queueEntryId)
    .eq("clinic_id", clinicId);

  if (error) throw new Error(error.message);
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
