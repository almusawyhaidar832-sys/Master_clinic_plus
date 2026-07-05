import { getAdminClient } from "@/lib/supabase/admin";
import { resolveDoctorProfileId, insertNotifications } from "@/lib/notifications/server";
import { sendWebPushToProfile } from "@/lib/push/server";
import {
  broadcastAdmitRequestServer,
  broadcastBillingReadyServer,
  broadcastPatientSentToDoctorServer,
  broadcastQueueScreenCallServer,
} from "@/lib/queue/broadcast-server";
import { resolvePatientGender } from "@/lib/queue/patient-gender";
import {
  formatAccountantBillingAlertMessage,
  formatDoctorQueueAlertMessage,
  trimDoctorQueueNotes,
  trimQueueIntakeNotes,
} from "@/lib/queue/intake-notes";
import {
  resolvePatientDisplayName,
  resolveDoctorSpeechName,
  resolvePatientSpeechName,
} from "@/lib/queue/utils";
import { normalizeOptionalPatientPhone, patientPhoneColumns } from "@/lib/phone";
import { buildQueueAnnounceAudioUrl, warmQueueAnnounceAudio } from "@/lib/queue/queue-announce-audio-url";

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
  cancellation_requested_at: string | null;
  cancellation_requested_by: string | null;
  cancellation_actor_label: string | null;
  notes: string | null;
  doctor_notes: string | null;
  doctor: { full_name_ar: string } | null;
  transfer_to_doctor?: { full_name_ar: string } | null;
  patient: { full_name_ar: string; speech_name_ar?: string | null; gender?: string | null } | null;
}

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

async function pushQueueBroadcasts(
  tasks: Array<Promise<void>>
): Promise<void> {
  await Promise.allSettled(tasks);
}

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
  payload: { title_ar: string; body_ar: string; link_path: string },
  options?: { patientName?: string; webPushTag?: string; webPushKind?: string }
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

  if (!options?.patientName) return;

  await Promise.allSettled(
    staff.map((s) =>
      sendWebPushToProfile(s.id, {
        title: payload.title_ar,
        body: payload.body_ar,
        url: payload.link_path,
        tag: options.webPushTag ?? `accountant-${Date.now()}`,
        patientName: options.patientName,
        kind: options.webPushKind ?? "accountant_queue",
      })
    )
  );
}

function queueBroadcastContext(entry: {
  id: string;
  clinic_id: string;
  doctor_id: string;
  patient_name: string | null;
  ticket_number: number;
  patient: {
    full_name_ar: string;
    speech_name_ar?: string | null;
    gender?: string | null;
  } | null;
  doctor: { full_name_ar: string; speech_name_ar?: string | null } | null;
}) {
  const patientRow = entry.patient;
  return {
    entryId: entry.id,
    clinicId: entry.clinic_id,
    doctorId: entry.doctor_id,
    ticketNumber: entry.ticket_number,
    name: resolvePatientSpeechName({
      patient: patientRow,
      patient_name: entry.patient_name,
      ticket_number: entry.ticket_number,
    }),
    doctorName: resolveDoctorSpeechName(entry.doctor),
    gender: resolvePatientGender({
      patient: patientRow,
      patient_name: entry.patient_name,
    }),
  };
}

/** نداء شاشة الانتظار — من السيرفر فور تغيير الحالة */
export async function emitQueueScreenCall(
  queueEntryId: string,
  options?: { recall?: boolean }
) {
  const entry = await loadQueueEntryContext(queueEntryId);
  const ctx = queueBroadcastContext(entry);
  await broadcastQueueScreenCallServer(entry.clinic_id, {
    name: ctx.name,
    doctorName: ctx.doctorName,
    entryId: ctx.entryId,
    ticketNumber: ctx.ticketNumber,
    gender: ctx.gender ?? undefined,
    recall: options?.recall === true,
    audioUrl: buildQueueAnnounceAudioUrl(queueEntryId, "queue_screen"),
  });
}

function todayIsoDate() {
  return new Date().toISOString().split("T")[0];
}

/** Fetch today's queue for a clinic (optionally filtered by doctor) */
export async function fetchClinicQueue(
  clinicId: string,
  opts?: {
    doctorId?: string;
    includeDone?: boolean;
    /** إخفاء المراجعين الذين طُلب إلغاؤهم — شاشة النداء وغرفة الطبيب */
    excludeCancellationPending?: boolean;
  }
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
    query = query.is("cancellation_requested_at", null);
  } else if (opts?.excludeCancellationPending) {
    query = query.is("cancellation_requested_at", null);
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
      "id, clinic_id, doctor_id, patient_name, ticket_number, patient_id, notes, patient:patients(full_name_ar, speech_name_ar, gender)"
    )
    .eq("id", queueEntryId)
    .maybeSingle();

  if (error || !entry) throw new Error("queue entry not found");

  const profileId = await resolveDoctorProfileId(
    admin,
    entry.doctor_id,
    entry.clinic_id
  );

  const patientRow = entry.patient as {
    full_name_ar?: string;
    speech_name_ar?: string | null;
    gender?: string | null;
  } | null;
  const displayName = resolvePatientDisplayName({
    patient: patientRow ? { full_name_ar: patientRow.full_name_ar ?? "" } : null,
    patient_name: entry.patient_name,
    ticket_number: entry.ticket_number,
  });
  const speechName = resolvePatientSpeechName({
    patient: patientRow
      ? {
          full_name_ar: patientRow.full_name_ar ?? "",
          speech_name_ar: patientRow.speech_name_ar,
        }
      : null,
    patient_name: entry.patient_name,
    ticket_number: entry.ticket_number,
  });

  const recall = options?.recall === true;
  const intakeNotes = trimQueueIntakeNotes(entry.notes as string | null);
  const titleAr = recall
    ? "تذكير — مراجع في الانتظار"
    : "مراجع جديد في الانتظار";
  const bodyAr = formatDoctorQueueAlertMessage(displayName, {
    recall,
    notes: intakeNotes,
  });

  if (profileId) {
    await insertNotifications([
      {
        clinic_id: entry.clinic_id,
        recipient_profile_id: profileId,
        title_ar: titleAr,
        body_ar: bodyAr,
        link_path: "/doctor/queue",
      },
    ]);
  } else {
    console.error(
      "[queue] doctor profile not linked — push/in-app limited:",
      entry.doctor_id,
      "queue:",
      queueEntryId
    );
  }

  if (profileId) {
    await sendWebPushToProfile(profileId, {
      title: recall ? "تذكير — مراجع 🔔" : "مراجع جديد 🔔",
      body: bodyAr,
      url: "/doctor/queue",
      tag: recall
        ? `doctor-recall-${entry.id}-${Date.now()}`
        : `doctor-queue-${entry.id}`,
      patientName: speechName,
      kind: "doctor_queue",
    }).catch((err) => {
      console.error("[queue] doctor web push failed:", err);
    });
  }

  await pushQueueBroadcasts([
    broadcastPatientSentToDoctorServer(entry.doctor_id as string, {
      name: speechName,
      entryId: entry.id as string,
      recall,
      sentAt: recall ? new Date().toISOString() : undefined,
      notes: intakeNotes ?? undefined,
    }),
  ]).catch((err) => {
    console.error("[queue] doctor broadcast failed:", err);
  });
}

/** Notify accountants: doctor sent session for billing */
export async function notifyAccountantsReadyForBilling(queueEntryId: string) {
  const admin = getAdminClient();

  const { data: entry, error } = await admin
    .from("patient_queue")
    .select(
      "id, clinic_id, patient_name, ticket_number, patient_id, doctor_notes, patient:patients(full_name_ar, speech_name_ar, gender)"
    )
    .eq("id", queueEntryId)
    .maybeSingle();

  if (error || !entry) return;

  const patientRow = entry.patient as {
    full_name_ar?: string;
    speech_name_ar?: string | null;
    gender?: string | null;
  } | null;
  const name = resolvePatientDisplayName({
    patient: patientRow ? { full_name_ar: patientRow.full_name_ar ?? "" } : null,
    patient_name: entry.patient_name,
    ticket_number: entry.ticket_number,
  });

  const ledgerPath = `/dashboard/ledger?queue_entry_id=${entry.id}`;
  const speechName = resolvePatientSpeechName({
    patient: patientRow ? { full_name_ar: patientRow.full_name_ar ?? "" } : null,
    patient_name: entry.patient_name,
    ticket_number: entry.ticket_number,
  });
  const gender = resolvePatientGender({
    patient: patientRow,
    patient_name: entry.patient_name,
  });
  const doctorNotes = trimDoctorQueueNotes(entry.doctor_notes as string | null);
  const billingBody = formatAccountantBillingAlertMessage(name, doctorNotes);

  const clinicId = entry.clinic_id as string;
  const entryId = entry.id as string;
  const billingAudioUrl = buildQueueAnnounceAudioUrl(entryId, "accountant_billing");

  warmQueueAnnounceAudio(entryId, "accountant_billing");

  await pushQueueBroadcasts([
    broadcastBillingReadyServer(clinicId, {
      name: speechName,
      entryId,
      linkPath: ledgerPath,
      gender: gender ?? undefined,
      doctorNotes: doctorNotes ?? undefined,
      audioUrl: billingAudioUrl,
    }),
  ]).catch((err) => {
    console.error("[queue] billing broadcast failed:", err);
  });

  void deliverAccountantBillingFollowups({
    clinicId,
    entryId,
    billingBody,
    ledgerPath,
    speechName,
    billingAudioUrl,
  }).catch((err) => {
    console.error("[queue] billing notify background failed:", err);
  });
}

async function deliverAccountantBillingFollowups(input: {
  clinicId: string;
  entryId: string;
  billingBody: string;
  ledgerPath: string;
  speechName: string;
  billingAudioUrl?: string;
}) {
  const admin = getAdminClient();
  const { data: staff } = await admin
    .from("profiles")
    .select("id")
    .eq("clinic_id", input.clinicId)
    .in("role", ["accountant", "super_admin", "assistant"]);

  if (!staff?.length) return;

  await Promise.allSettled([
    insertNotifications(
      staff.map((s) => ({
        clinic_id: input.clinicId,
        recipient_profile_id: s.id,
        title_ar: "جلسة جاهزة للمحاسبة",
        body_ar: `${input.billingBody}، افتح إدخال الجلسة`,
        link_path: input.ledgerPath,
      }))
    ),
    ...staff.map((s) =>
      sendWebPushToProfile(s.id, {
        title: "جلسة جاهزة للمحاسبة 🔔",
        body: input.billingBody,
        url: input.ledgerPath,
        tag: `billing-${input.entryId}`,
        entryId: input.entryId,
        patientName: input.speechName,
        kind: "accountant_billing",
        audioUrl: input.billingAudioUrl,
      })
    ),
  ]);
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
  const speechName = resolvePatientSpeechName({
    patient: patientRow ? { full_name_ar: patientRow.full_name_ar ?? "" } : null,
    patient_name: entry.patient_name,
    ticket_number: entry.ticket_number,
  });

  await insertNotifications(
    staff.map((s) => ({
      clinic_id: entry.clinic_id,
      recipient_profile_id: s.id,
      title_ar: "جاهز للدفع",
      body_ar: `المراجع ${name} — الجلسة جاهزة، أكمل الحساب الآن`,
      link_path: ledgerPath,
    }))
  );

  await Promise.allSettled(
    staff.map((s) =>
      sendWebPushToProfile(s.id, {
        title: "جاهز للدفع 🔔",
        body: `المراجع ${name} — أكمل الحساب الآن`,
        url: ledgerPath,
        tag: `payment-${entry.id}`,
        entryId: entry.id as string,
        patientName: speechName,
        kind: "accountant_payment",
      })
    )
  );
}

/** Notify accountants: doctor ready for patient to enter */
export async function notifyAccountantsPatientAdmit(queueEntryId: string) {
  const admin = getAdminClient();

  const { data: entry, error } = await admin
    .from("patient_queue")
    .select(
      "id, clinic_id, patient_name, ticket_number, patient_id, patient:patients(full_name_ar, speech_name_ar, gender)"
    )
    .eq("id", queueEntryId)
    .maybeSingle();

  if (error || !entry) throw new Error("queue entry not found");

  const patientRow = entry.patient as {
    full_name_ar?: string;
    speech_name_ar?: string | null;
    gender?: string | null;
  } | null;
  const name = resolvePatientDisplayName({
    patient: patientRow ? { full_name_ar: patientRow.full_name_ar ?? "" } : null,
    patient_name: entry.patient_name,
    ticket_number: entry.ticket_number,
  });
  const speechName = resolvePatientSpeechName({
    patient: patientRow ? { full_name_ar: patientRow.full_name_ar ?? "" } : null,
    patient_name: entry.patient_name,
    ticket_number: entry.ticket_number,
  });
  const gender = resolvePatientGender({
    patient: patientRow,
    patient_name: entry.patient_name,
  });

  const clinicId = entry.clinic_id as string;
  const entryId = entry.id as string;
  const admitAudioUrl = buildQueueAnnounceAudioUrl(entryId, "accountant_admit");

  warmQueueAnnounceAudio(entryId, "accountant_admit");

  await pushQueueBroadcasts([
    broadcastAdmitRequestServer(clinicId, {
      name: speechName,
      entryId,
      gender: gender ?? undefined,
      audioUrl: admitAudioUrl,
    }),
  ]).catch((err) => {
    console.error("[queue] admit broadcast failed:", err);
  });

  void deliverAccountantAdmitFollowups({
    clinicId,
    entryId,
    name,
    speechName,
    admitAudioUrl,
  }).catch((err) => {
    console.error("[queue] admit notify background failed:", err);
  });
}

async function deliverAccountantAdmitFollowups(input: {
  clinicId: string;
  entryId: string;
  name: string;
  speechName: string;
  admitAudioUrl?: string;
}) {
  const admin = getAdminClient();
  const { data: staff } = await admin
    .from("profiles")
    .select("id")
    .eq("clinic_id", input.clinicId)
    .in("role", ["accountant", "super_admin"]);

  if (!staff?.length) return;

  await Promise.allSettled([
    insertNotifications(
      staff.map((s) => ({
        clinic_id: input.clinicId,
        recipient_profile_id: s.id,
        title_ar: "ادخل المراجع للعيادة",
        body_ar: `المراجع ${input.name} — يُرجى دخوله للعيادة الآن`,
        link_path: "/dashboard/queue",
      }))
    ),
    ...staff.map((s) =>
      sendWebPushToProfile(s.id, {
        title: "طلب دخول مراجع 🔔",
        body: `المراجع ${input.name} — يُرجى دخوله للعيادة الآن`,
        url: "/dashboard/queue",
        tag: `admit-${input.entryId}`,
        entryId: input.entryId,
        patientName: input.speechName,
        kind: "accountant_admit",
        audioUrl: input.admitAudioUrl,
      })
    ),
  ]);
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

/** نداء المحاسب + شاشة انتظار المرضى معاً — عند طلب الطبيب دخول مراجع */
export async function notifyPatientAdmitAllTargets(
  queueEntryId: string,
  options?: { recall?: boolean }
) {
  await Promise.all([
    notifyAccountantsPatientAdmit(queueEntryId),
    emitQueueScreenCall(queueEntryId, { recall: options?.recall === true }),
  ]);
}

/** Re-notify accountants + TV screen: doctor requests patient entry again */
export async function recallAccountantNotification(queueEntryId: string) {
  await notifyPatientAdmitAllTargets(queueEntryId, { recall: true }).catch((err) => {
    console.error("[queue] admit recall failed:", err);
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
  queue_date?: string;
  notes?: string | null;
}) {
  const admin = getAdminClient();
  const queueDate = input.queue_date ?? todayIsoDate();

  const phoneResult = normalizeOptionalPatientPhone(input.patient_phone);
  if (!phoneResult.ok) {
    throw new Error(phoneResult.message);
  }
  const normalizedPhone = phoneResult.phone;

  const { data, error } = await admin
    .from("patient_queue")
    .insert({
      clinic_id: input.clinic_id,
      doctor_id: input.doctor_id,
      patient_name: input.patient_name?.trim() || null,
      patient_phone: normalizedPhone,
      patient_id: input.patient_id ?? null,
      appointment_id: input.appointment_id ?? null,
      queue_date: queueDate,
      status: "waiting",
      source: input.source ?? "walk_in",
      sent_to_doctor_at: input.send_to_doctor ? new Date().toISOString() : null,
      notes: trimQueueIntakeNotes(input.notes),
    })
    .select("id")
    .single();

  if (error) throw new Error(error.message);

  const entryId = data.id as string;

  if (input.patient_id && normalizedPhone) {
    await admin
      .from("patients")
      .update(patientPhoneColumns(normalizedPhone))
      .eq("id", input.patient_id)
      .eq("clinic_id", input.clinic_id)
      .then(({ error: phoneErr }) => {
        if (phoneErr) {
          console.error("[queue] sync patient phone on insert failed:", phoneErr);
        }
      });
  }

  if (!input.patient_id && entryId) {
    const hasIdentity =
      Boolean(input.patient_name?.trim()) || Boolean(normalizedPhone);
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
  opts?: { clinicId?: string; doctorId?: string; fromStatus?: QueueStatus }
) {
  const admin = getAdminClient();

  const patch: Record<string, unknown> = { status };
  if (status === "called" && opts?.fromStatus === "waiting") {
    patch.called_at = new Date().toISOString();
  }
  if (status === "in_progress" && opts?.fromStatus === "called") {
    patch.entered_at = new Date().toISOString();
  }

  let query = admin
    .from("patient_queue")
    .update(patch)
    .eq("id", queueEntryId);

  if (opts?.clinicId) query = query.eq("clinic_id", opts.clinicId);
  if (opts?.doctorId) query = query.eq("doctor_id", opts.doctorId);
  // شرط الحالة الحالية مباشرة على الـ UPDATE (وليس فحصاً منفصلاً قبله) —
  // يمنع تحوّلاً غير متوقع لو تغيّرت حالة الدور بين الفحص والتحديث
  if (opts?.fromStatus) query = query.eq("status", opts.fromStatus);

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

/** طلب إلغاء من الطبيب أو المساعد — إشعار المحاسب للتحويل أو الإلغاء النهائي */
export async function requestQueueCancellationByStaff(
  queueEntryId: string,
  actor: {
    profileId: string;
    role: "doctor" | "assistant";
    doctorId: string;
  }
) {
  const admin = getAdminClient();
  const entry = await loadQueueEntryContext(queueEntryId);

  if (entry.doctor_id !== actor.doctorId) {
    throw new Error("غير مصرح");
  }
  if (!DOCTOR_QUEUE_ACTION_STATUSES.includes(entry.status)) {
    throw new Error("لا يمكن الإلغاء في هذه المرحلة");
  }

  const doctorName = await fetchDoctorNameById(admin, actor.doctorId);
  const actorLabel =
    actor.role === "assistant"
      ? `المساعد (طبيب ${doctorName})`
      : `الطبيب ${doctorName}`;
  const patientName = resolveQueuePatientName(entry);
  const now = new Date().toISOString();

  const { error } = await admin
    .from("patient_queue")
    .update({
      cancellation_requested_at: now,
      cancellation_requested_by: actor.profileId,
      cancellation_actor_label: actorLabel,
      called_at: null,
      sent_to_doctor_at: null,
      status: "waiting",
      transfer_to_doctor_id: null,
      transfer_from_doctor_id: null,
      transfer_requested_at: null,
    })
    .eq("id", queueEntryId)
    .eq("doctor_id", actor.doctorId)
    .in("status", DOCTOR_QUEUE_ACTION_STATUSES);

  if (error) throw new Error(error.message);

  await notifyAccountantProfiles(entry.clinic_id, {
    title_ar: "طلب إلغاء من غرفة الانتظار",
    body_ar: `${actorLabel} ألغى حالة المراجع ${patientName} — حوّله لطبيب آخر أو ألغِ الحجز نهائياً`,
    link_path: "/dashboard/queue",
  });
}

/** رفض الطبيب للمراجع — طلب إلغاء + إشعار المحاسب */
export async function rejectQueueEntryByDoctor(
  queueEntryId: string,
  doctorId: string,
  profileId: string
) {
  await requestQueueCancellationByStaff(queueEntryId, {
    profileId,
    role: "doctor",
    doctorId,
  });
}

/** طلب تحويل مراجع لطبيب آخر — بانتظار تأكيد المحاسب (طبيب أو مساعد) */
export async function requestQueueTransferByStaff(
  queueEntryId: string,
  actor: {
    profileId: string;
    role: "doctor" | "assistant";
    doctorId: string;
  },
  targetDoctorId: string
) {
  const admin = getAdminClient();
  const entry = await loadQueueEntryContext(queueEntryId);
  const { doctorId } = actor;

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
  const actorLabel =
    actor.role === "assistant"
      ? `المساعد (طبيب ${fromName})`
      : `الطبيب ${fromName}`;
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
    body_ar: `${actorLabel} يطلب تحويل ${patientName} إلى ${toName}`,
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

  // شرط الحالة الحالية مباشرة على الـ UPDATE — يمنع تحويل دور غيّر الطبيب
  // حالته بنفس اللحظة (مثلاً ضغط "دخول") من المرور بصمت وفقدان بيانات الكشف
  const { data: updated, error } = await admin
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
    .eq("clinic_id", clinicId)
    .eq("doctor_id", fromDoctorId)
    .eq("transfer_to_doctor_id", toDoctorId)
    .in("status", DOCTOR_QUEUE_ACTION_STATUSES)
    .select("id")
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!updated) {
    throw new Error("تعذر إتمام التحويل — تغيّرت حالة الدور قبل التأكيد");
  }

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

/** المحاسب — تحويل مراجع مباشرة لطبيب آخر (بدون طلب من الطبيب) */
export async function transferQueueByAccountant(
  queueEntryId: string,
  clinicId: string,
  targetDoctorId: string
) {
  const admin = getAdminClient();
  const entry = await loadQueueEntryContext(queueEntryId);

  if (entry.clinic_id !== clinicId) {
    throw new Error("غير مصرح");
  }
  if (entry.transfer_to_doctor_id) {
    throw new Error("يوجد طلب تحويل معلّق — أكّده أو ارفضه أولاً");
  }
  if (entry.cancellation_requested_at) {
    throw new Error("يوجد طلب إلغاء — أكّد الإلغاء أو حوّل من زر طلب الإلغاء");
  }
  if (!DOCTOR_QUEUE_ACTION_STATUSES.includes(entry.status)) {
    throw new Error("لا يمكن التحويل في هذه المرحلة");
  }
  if (targetDoctorId === entry.doctor_id) {
    throw new Error("اختر طبيباً غير الحالي");
  }

  const { data: target } = await admin
    .from("doctors")
    .select("id, full_name_ar, clinic_id, is_active")
    .eq("id", targetDoctorId)
    .maybeSingle();

  if (!target || target.clinic_id !== entry.clinic_id || !target.is_active) {
    throw new Error("الطبيب المستهدف غير متاح");
  }

  const fromDoctorId = entry.doctor_id;
  const fromName = await fetchDoctorNameById(admin, fromDoctorId);
  const patientName = resolveQueuePatientName(entry);
  const now = new Date().toISOString();

  const { data: updated, error } = await admin
    .from("patient_queue")
    .update({
      doctor_id: targetDoctorId,
      status: "waiting",
      called_at: null,
      sent_to_doctor_at: now,
      transfer_to_doctor_id: null,
      transfer_from_doctor_id: null,
      transfer_requested_at: null,
    })
    .eq("id", queueEntryId)
    .eq("clinic_id", clinicId)
    .eq("doctor_id", fromDoctorId)
    .is("transfer_to_doctor_id", null)
    .is("cancellation_requested_at", null)
    .in("status", DOCTOR_QUEUE_ACTION_STATUSES)
    .select("id")
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!updated) {
    throw new Error("تعذر التحويل — تغيّرت حالة الدور قبل الإتمام");
  }

  if (entry.appointment_id) {
    await admin
      .from("appointments")
      .update({ doctor_id: targetDoctorId })
      .eq("id", entry.appointment_id)
      .eq("clinic_id", clinicId);
  }

  const profileId = await resolveDoctorProfileId(admin, targetDoctorId, clinicId);
  if (profileId) {
    await insertNotifications([
      {
        clinic_id: clinicId,
        recipient_profile_id: profileId,
        title_ar: "حالة محوّلة إليك",
        body_ar: `المراجع ${patientName} — حوّله المحاسب من الطبيب ${fromName}`,
        link_path: "/doctor/queue",
      },
    ]);
  }
}

/** المحاسب — إلغاء نهائي للدور والحجز بعد طلب الطبيب/المساعد */
export async function finalizeQueueCancellationByAccountant(
  queueEntryId: string,
  clinicId: string
) {
  const admin = getAdminClient();
  const entry = await loadQueueEntryContext(queueEntryId);

  if (entry.clinic_id !== clinicId) {
    throw new Error("غير مصرح");
  }
  if (!entry.cancellation_requested_at) {
    throw new Error("لا يوجد طلب إلغاء لهذا الدور");
  }

  // requestQueueCancellationByStaff تضبط الحالة دوماً على "waiting" عند
  // الطلب — هذا الشرط يمنع إلغاء دور "قيد الكشف" أو "مكتمل" تغيّرت حالته
  // بعد الطلب (كان بدون أي شرط حالة إطلاقاً بالكود القديم)
  const { data: updated, error } = await admin
    .from("patient_queue")
    .update({
      status: "cancelled",
      cancellation_requested_at: null,
      cancellation_requested_by: null,
      cancellation_actor_label: null,
      transfer_to_doctor_id: null,
      transfer_from_doctor_id: null,
      transfer_requested_at: null,
    })
    .eq("id", queueEntryId)
    .eq("clinic_id", clinicId)
    .eq("status", "waiting")
    .not("cancellation_requested_at", "is", null)
    .select("id")
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!updated) {
    throw new Error("تعذر إلغاء الحجز — تغيّرت حالة الدور قبل الإلغاء");
  }
}

/** المحاسب — تحويل مراجع بعد طلب إلغاء من الطبيب/المساعد */
export async function accountantTransferAfterCancellation(
  queueEntryId: string,
  clinicId: string,
  targetDoctorId: string
) {
  const admin = getAdminClient();
  const entry = await loadQueueEntryContext(queueEntryId);

  if (entry.clinic_id !== clinicId) {
    throw new Error("غير مصرح");
  }
  if (!entry.cancellation_requested_at) {
    throw new Error("لا يوجد طلب إلغاء لهذا الدور");
  }
  if (targetDoctorId === entry.doctor_id) {
    throw new Error("اختر طبيباً غير الحالي");
  }

  const { data: target } = await admin
    .from("doctors")
    .select("id, full_name_ar, clinic_id, is_active")
    .eq("id", targetDoctorId)
    .maybeSingle();

  if (!target || target.clinic_id !== entry.clinic_id || !target.is_active) {
    throw new Error("الطبيب المستهدف غير متاح");
  }

  const fromDoctorId = entry.doctor_id;
  const fromName = await fetchDoctorNameById(admin, fromDoctorId);
  const patientName = resolveQueuePatientName(entry);
  const now = new Date().toISOString();

  // نفس شرط finalizeQueueCancellationByAccountant — لا نحوّل دوراً تغيّرت
  // حالته أو طبيبه بعد طلب الإلغاء
  const { data: updated, error } = await admin
    .from("patient_queue")
    .update({
      doctor_id: targetDoctorId,
      status: "waiting",
      called_at: null,
      sent_to_doctor_at: now,
      cancellation_requested_at: null,
      cancellation_requested_by: null,
      cancellation_actor_label: null,
      transfer_to_doctor_id: null,
      transfer_from_doctor_id: null,
      transfer_requested_at: null,
    })
    .eq("id", queueEntryId)
    .eq("clinic_id", clinicId)
    .eq("doctor_id", fromDoctorId)
    .eq("status", "waiting")
    .not("cancellation_requested_at", "is", null)
    .select("id")
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!updated) {
    throw new Error("تعذر التحويل — تغيّرت حالة الدور قبل الإتمام");
  }

  if (entry.appointment_id) {
    await admin
      .from("appointments")
      .update({ doctor_id: targetDoctorId })
      .eq("id", entry.appointment_id)
      .eq("clinic_id", clinicId);
  }

  const profileId = await resolveDoctorProfileId(admin, targetDoctorId, clinicId);
  if (profileId) {
    await insertNotifications([
      {
        clinic_id: clinicId,
        recipient_profile_id: profileId,
        title_ar: "حالة محوّلة إليك",
        body_ar: `المراجع ${patientName} — حوّله المحاسب من الطبيب ${fromName}`,
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
