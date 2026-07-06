import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { QueueStatus } from "@/lib/queue/server";
import { ensureQueueEntryPatient } from "@/lib/services/ensure-queue-entry-patient";
import { todayISO } from "@/lib/utils";

const ACTIVE_QUEUE_STATUSES: QueueStatus[] = [
  "called",
  "in_progress",
  "ready_for_billing",
  "ready_for_payment",
];

export const CLINICAL_SESSION_LABEL = "جلسة كشف — سجل بصري";

function isMissingColumnError(message: string, column: string): boolean {
  const msg = message.toLowerCase();
  const col = column.toLowerCase();
  return (
    msg.includes(col) &&
    (msg.includes("schema cache") ||
      msg.includes("could not find") ||
      msg.includes("does not exist"))
  );
}

function isDuplicateQueueEntryError(message: string): boolean {
  const msg = message.toLowerCase();
  return (
    msg.includes("uq_patient_operations_queue_entry") ||
    (msg.includes("duplicate key") && msg.includes("queue_entry"))
  );
}

function stripOptionalInsertFields(
  payload: Record<string, unknown>,
  errorMessage: string
): Record<string, unknown> | null {
  if (
    isMissingColumnError(errorMessage, "operation_name_ar") &&
    "operation_name_ar" in payload
  ) {
    const next = { ...payload };
    next.operation_type = next.operation_name_ar;
    delete next.operation_name_ar;
    return next;
  }

  for (const column of ["created_by", "queue_entry_id"] as const) {
    if (isMissingColumnError(errorMessage, column) && column in payload) {
      const next = { ...payload };
      delete next[column];
      return next;
    }
  }

  return null;
}

async function findOperationIdByQueueEntry(
  admin: SupabaseClient,
  queueEntryId: string
): Promise<string | null> {
  const { data, error } = await admin
    .from("patient_operations")
    .select("id")
    .eq("queue_entry_id", queueEntryId)
    .maybeSingle();

  if (error) {
    if (isMissingColumnError(error.message, "queue_entry_id")) return null;
    return null;
  }

  return (data?.id as string | undefined) ?? null;
}

/** يعيد operation_id الفعلي المرتبط بالطابور (قد يختلف إذا وُجدت جلسة مسبقاً). */
async function linkQueueEntryToOperation(
  admin: SupabaseClient,
  operationId: string,
  queueEntryId: string
): Promise<string> {
  const existingByQueue = await findOperationIdByQueueEntry(admin, queueEntryId);
  if (existingByQueue) {
    return existingByQueue;
  }

  const { error } = await admin
    .from("patient_operations")
    .update({ queue_entry_id: queueEntryId })
    .eq("id", operationId);

  if (!error) {
    return operationId;
  }

  if (isDuplicateQueueEntryError(error.message)) {
    const linked = await findOperationIdByQueueEntry(admin, queueEntryId);
    if (linked) return linked;
  }

  if (!isMissingColumnError(error.message, "queue_entry_id")) {
    console.error("[visit-session] link queue failed:", error.message);
  }

  return operationId;
}

export interface VisitSessionContext {
  operationId: string;
  queueEntryId: string | null;
  queueStatus: QueueStatus | null;
  patientId: string;
  doctorId: string;
  appointmentId: string | null;
  /** true إذا لم يُربط بطابور نشط */
  withoutQueue?: boolean;
}

async function appointmentPatientId(
  admin: SupabaseClient,
  appointmentId: string | null | undefined
): Promise<string | null> {
  if (!appointmentId) return null;
  const { data } = await admin
    .from("appointments")
    .select("patient_id")
    .eq("id", appointmentId)
    .maybeSingle();
  return (data?.patient_id as string | null) ?? null;
}

async function queueEntryMatchesPatient(
  admin: SupabaseClient,
  entry: {
    patient_id: string | null;
    appointment_id?: string | null;
  },
  patientId: string
): Promise<boolean> {
  if (entry.patient_id === patientId) return true;
  const apptPatient = await appointmentPatientId(
    admin,
    entry.appointment_id as string | null
  );
  return apptPatient === patientId;
}

export async function findActiveQueueEntryForVisit(
  admin: SupabaseClient,
  input: {
    clinicId: string;
    doctorId: string;
    patientId: string;
    queueEntryId?: string | null;
  }
) {
  if (input.queueEntryId) {
    const { data: entry } = await admin
      .from("patient_queue")
      .select(
        "id, status, patient_id, doctor_id, clinic_id, appointment_id, queue_date"
      )
      .eq("id", input.queueEntryId)
      .eq("clinic_id", input.clinicId)
      .maybeSingle();

    if (!entry) return null;
    if (entry.doctor_id !== input.doctorId) return null;

    const matches = await queueEntryMatchesPatient(admin, entry, input.patientId);
    if (!matches && entry.patient_id) return null;

    return entry;
  }

  const { data: entries } = await admin
    .from("patient_queue")
    .select(
      "id, status, patient_id, doctor_id, clinic_id, appointment_id, queue_date, entered_at"
    )
    .eq("clinic_id", input.clinicId)
    .eq("doctor_id", input.doctorId)
    .eq("queue_date", todayISO())
    .in("status", ACTIVE_QUEUE_STATUSES)
    .order("entered_at", { ascending: false, nullsFirst: false });

  const rows = entries ?? [];
  const matched: typeof rows = [];

  for (const row of rows) {
    if (await queueEntryMatchesPatient(admin, row, input.patientId)) {
      matched.push(row);
    }
  }

  const priority = (status: string) => {
    if (status === "in_progress") return 0;
    if (status === "ready_for_billing") return 1;
    if (status === "ready_for_payment") return 2;
    return 3;
  };

  matched.sort(
    (a, b) => priority(String(a.status)) - priority(String(b.status))
  );

  return matched[0] ?? null;
}

async function findTodayClinicalOperation(
  admin: SupabaseClient,
  input: { clinicId: string; doctorId: string; patientId: string }
) {
  const { data: rows } = await admin
    .from("patient_operations")
    .select("id, operation_name_ar, operation_type, total_amount")
    .eq("clinic_id", input.clinicId)
    .eq("patient_id", input.patientId)
    .eq("doctor_id", input.doctorId)
    .eq("operation_date", todayISO())
    .order("created_at", { ascending: false });

  for (const row of rows ?? []) {
    const label = String(row.operation_name_ar ?? row.operation_type ?? "");
    if (label === CLINICAL_SESSION_LABEL) return row;
    if (Number(row.total_amount ?? 0) === 0) return row;
  }

  return null;
}

async function insertClinicalOperation(
  admin: SupabaseClient,
  payload: Record<string, unknown>
): Promise<string> {
  let current: Record<string, unknown> = { ...payload };

  for (let attempt = 0; attempt < 6; attempt++) {
    const { data: created, error } = await admin
      .from("patient_operations")
      .insert(current)
      .select("id")
      .single();

    if (!error && created?.id) {
      return created.id as string;
    }

    const message = String(error?.message ?? "");
    const queueEntryId = current.queue_entry_id as string | undefined;
    if (queueEntryId && isDuplicateQueueEntryError(message)) {
      const existing = await findOperationIdByQueueEntry(admin, queueEntryId);
      if (existing) return existing;
    }

    const stripped = stripOptionalInsertFields(current, message);
    if (stripped) {
      current = stripped;
      continue;
    }

    throw new Error(
      message ||
        "تعذر إنشاء جلسة الكشف — شغّل supabase/scripts/32-visit-session-operation.sql على Supabase"
    );
  }

  throw new Error("تعذر إنشاء جلسة الكشف");
}

export async function ensureVisitSessionOperation(
  admin: SupabaseClient,
  input: {
    clinicId: string;
    doctorId: string;
    patientId: string;
    queueEntryId?: string | null;
    createdBy?: string | null;
    /** إنشاء جلسة بصرية حتى بدون طابور نشط */
    allowWithoutQueue?: boolean;
  }
): Promise<VisitSessionContext> {
  const entry = await findActiveQueueEntryForVisit(admin, input);
  const queueEntryId =
    ((entry?.id as string | null) ?? input.queueEntryId?.trim()) || null;
  const queueStatus = entry
    ? (entry.status as QueueStatus)
    : null;

  if (queueEntryId) {
    const existingOpId = await findOperationIdByQueueEntry(admin, queueEntryId);
    if (existingOpId) {
      return {
        operationId: existingOpId,
        queueEntryId,
        queueStatus,
        patientId: input.patientId,
        doctorId: input.doctorId,
        appointmentId: (entry?.appointment_id as string | null) ?? null,
      };
    }
    /* كل دور طابور = جلسة كشف مستقلة — لا نعيد استخدام جلسة اليوم السابقة */
  } else {
    const existingToday = await findTodayClinicalOperation(admin, input);

    if (existingToday?.id) {
      return {
        operationId: existingToday.id as string,
        queueEntryId: null,
        queueStatus,
        patientId: input.patientId,
        doctorId: input.doctorId,
        appointmentId: (entry?.appointment_id as string | null) ?? null,
      };
    }
  }

  if (!queueEntryId && !input.allowWithoutQueue) {
    throw new Error(
      "لا توجد زيارة نشطة اليوم — ابدأ الكشف من قائمة الانتظار، أو افتح المريض من الطابور أثناء الكشف"
    );
  }

  const payload: Record<string, unknown> = {
    clinic_id: input.clinicId,
    patient_id: input.patientId,
    doctor_id: input.doctorId,
    operation_date: todayISO(),
    operation_name_ar: CLINICAL_SESSION_LABEL,
    total_amount: 0,
    paid_amount: 0,
  };

  if (queueEntryId) {
    payload.queue_entry_id = queueEntryId;
    const existingBeforeInsert = await findOperationIdByQueueEntry(
      admin,
      queueEntryId
    );
    if (existingBeforeInsert) {
      return {
        operationId: existingBeforeInsert,
        queueEntryId,
        queueStatus,
        patientId: input.patientId,
        doctorId: input.doctorId,
        appointmentId: (entry?.appointment_id as string | null) ?? null,
      };
    }
  }
  if (input.createdBy) {
    payload.created_by = input.createdBy;
  }

  const operationId = await insertClinicalOperation(admin, payload);

  return {
    operationId,
    queueEntryId,
    queueStatus,
    patientId: input.patientId,
    doctorId: input.doctorId,
    appointmentId: (entry?.appointment_id as string | null) ?? null,
    withoutQueue: !queueEntryId,
  };
}

export async function resolvePatientIdFromQueueEntry(
  admin: SupabaseClient,
  clinicId: string,
  queueEntryId: string
): Promise<{
  patientId: string;
  doctorId: string;
  appointmentId: string | null;
} | null> {
  try {
    const ctx = await ensureQueueEntryPatient(admin, queueEntryId, clinicId);
    return {
      patientId: ctx.patientId,
      doctorId: ctx.doctorId,
      appointmentId: ctx.appointmentId,
    };
  } catch {
    return null;
  }
}

export async function getVisitSessionByQueueEntry(
  admin: SupabaseClient,
  clinicId: string,
  queueEntryId: string
): Promise<VisitSessionContext | null> {
  const { data: entry } = await admin
    .from("patient_queue")
    .select("id, status, patient_id, doctor_id, appointment_id, clinic_id")
    .eq("id", queueEntryId)
    .eq("clinic_id", clinicId)
    .maybeSingle();

  if (!entry?.doctor_id) return null;

  let patientId = entry.patient_id as string | null;
  if (!patientId) {
    try {
      const ctx = await ensureQueueEntryPatient(admin, queueEntryId, clinicId);
      patientId = ctx.patientId;
    } catch {
      return null;
    }
  }

  const operationId = await findOperationIdByQueueEntry(admin, queueEntryId);
  if (!operationId) return null;

  const { data: opRow } = await admin
    .from("patient_operations")
    .select("doctor_id")
    .eq("id", operationId)
    .maybeSingle();

  return {
    operationId,
    queueEntryId: entry.id as string,
    queueStatus: entry.status as QueueStatus,
    patientId,
    doctorId: (opRow?.doctor_id as string | undefined) ?? (entry.doctor_id as string),
    appointmentId: (entry.appointment_id as string | null) ?? null,
  };
}
