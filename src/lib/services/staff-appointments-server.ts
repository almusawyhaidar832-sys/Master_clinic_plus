import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { writeAuditLog } from "@/lib/audit/write-audit-log";
import { validatePatientPhone } from "@/lib/phone";
import { translateDbError } from "@/lib/db-errors";
import { ensurePatientProfileForBooking } from "@/lib/services/resolve-patient-id";
import {
  sendAppointmentUpdate,
  type SendAppointmentUpdateResult,
} from "@/lib/services/appointment-updates";
import {
  enqueueApprovedAppointment,
  notifyDoctorForApprovedAppointment,
} from "@/lib/services/appointment-queue-sync";
import type { Appointment } from "@/types";

function timesOverlap(
  aStart: string,
  aEnd: string,
  bStart: string,
  bEnd: string
): boolean {
  return aStart < bEnd && bStart < aEnd;
}

export interface AppointmentAuditActor {
  changedBy: string;
  actorName?: string | null;
}

function appointmentSnapshot(row: Record<string, unknown>) {
  return {
    patient_name_ar: row.patient_name_ar,
    patient_phone: row.patient_phone,
    appointment_date: row.appointment_date,
    start_time: row.start_time,
    end_time: row.end_time,
    status: row.status,
    doctor_id: row.doctor_id,
    notes: row.notes,
  };
}

async function fetchDoctorName(
  admin: SupabaseClient,
  doctorId: string
): Promise<string> {
  const { data } = await admin
    .from("doctors")
    .select("full_name_ar")
    .eq("id", doctorId)
    .maybeSingle();
  return (data?.full_name_ar as string) || "الطبيب";
}

async function assertNoOverlapForDoctor(
  admin: SupabaseClient,
  clinicId: string,
  doctorId: string,
  date: string,
  startTime: string,
  endTime: string,
  excludeId?: string
): Promise<void> {
  const { data: existing } = await admin
    .from("appointments")
    .select("id, start_time, end_time, status")
    .eq("clinic_id", clinicId)
    .eq("doctor_id", doctorId)
    .eq("appointment_date", date)
    .neq("status", "cancelled");

  for (const row of existing ?? []) {
    if (excludeId && row.id === excludeId) continue;
    if (
      timesOverlap(
        startTime,
        endTime,
        row.start_time as string,
        row.end_time as string
      )
    ) {
      throw new Error("هذا الوقت محجوز مسبقاً — اختر وقتاً آخر");
    }
  }
}

/** موافقة على طلب باركود — اليوم: waiting + غرفة انتظار؛ مستقبل: confirmed فقط */
export async function approvePendingAppointment(
  admin: SupabaseClient,
  clinicId: string,
  appointmentId: string,
  opts?: { assistantId?: string | null }
): Promise<Appointment> {
  const { data: current } = await admin
    .from("appointments")
    .select("*")
    .eq("id", appointmentId)
    .eq("clinic_id", clinicId)
    .maybeSingle();

  if (!current) throw new Error("الموعد غير موجود");
  if (current.status !== "pending") {
    throw new Error("يمكن الموافقة على الطلبات بحالة «قيد المراجعة» فقط");
  }

  const appointmentDate = String(current.appointment_date ?? "").slice(0, 10);
  const today = new Date().toISOString().slice(0, 10);
  const isToday = appointmentDate === today;

  const updatePayload: Record<string, unknown> = {
    status: isToday ? "waiting" : "confirmed",
    reason_for_change: null,
  };
  if (opts?.assistantId) {
    updatePayload.assistant_id = opts.assistantId;
  }

  // شرط الحالة الحالية مباشرة على الـ UPDATE — يمنع قبول ورفض متزامنين لنفس
  // الموعد من المرور كليهما (كان الفحص أعلاه SELECT منفصلاً بدون قفل)
  const { data, error } = await admin
    .from("appointments")
    .update(updatePayload)
    .eq("id", appointmentId)
    .eq("status", "pending")
    .select("*")
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) {
    throw new Error("تعذّر الموافقة — تغيّرت حالة الموعد قبل الحفظ (رُفض أو عولج مسبقاً)");
  }

  let queueId: string | null = null;
  if (isToday) {
    queueId = await enqueueApprovedAppointment(admin, {
      id: data.id as string,
      clinic_id: data.clinic_id as string,
      doctor_id: data.doctor_id as string,
      patient_name_ar: data.patient_name_ar as string | null,
      patient_phone: data.patient_phone as string | null,
      patient_id: data.patient_id as string | null,
      appointment_date: data.appointment_date as string,
    });
    await notifyDoctorForApprovedAppointment(queueId);
  }

  const doctorName = await fetchDoctorName(admin, data.doctor_id as string);
  await sendAppointmentUpdate(admin, {
    clinicId,
    appointmentId: data.id as string,
    patientPhone: data.patient_phone as string,
    patientName: data.patient_name_ar as string,
    doctorName,
    appointmentDate: data.appointment_date as string,
    startTime: data.start_time as string,
    endTime: data.end_time as string,
    action: "accepted",
  });

  return data as Appointment;
}

export async function rejectPendingAppointment(
  admin: SupabaseClient,
  clinicId: string,
  appointmentId: string,
  reason_for_change: string,
  opts?: { assistantId?: string | null }
): Promise<Appointment> {
  const reason = reason_for_change?.trim();
  if (!reason) throw new Error("سبب الرفض مطلوب");

  const { data: current } = await admin
    .from("appointments")
    .select("*")
    .eq("id", appointmentId)
    .eq("clinic_id", clinicId)
    .maybeSingle();

  if (!current) throw new Error("الموعد غير موجود");
  if (current.status !== "pending") {
    throw new Error("يمكن رفض الطلبات بحالة «قيد المراجعة» فقط");
  }

  const updatePayload: Record<string, unknown> = {
    status: "cancelled",
    reason_for_change: reason,
  };
  if (opts?.assistantId) {
    updatePayload.assistant_id = opts.assistantId;
  }

  // نفس شرط approvePendingAppointment — يمنع قبول ورفض متزامنين لنفس الموعد
  const { data, error } = await admin
    .from("appointments")
    .update(updatePayload)
    .eq("id", appointmentId)
    .eq("status", "pending")
    .select("*")
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) {
    throw new Error("تعذّر الرفض — تغيّرت حالة الموعد قبل الحفظ (قُبل أو عولج مسبقاً)");
  }

  const doctorName = await fetchDoctorName(admin, data.doctor_id as string);
  await sendAppointmentUpdate(admin, {
    clinicId,
    appointmentId: data.id as string,
    patientPhone: data.patient_phone as string,
    patientName: data.patient_name_ar as string,
    doctorName,
    appointmentDate: data.appointment_date as string,
    startTime: data.start_time as string,
    endTime: data.end_time as string,
    action: "rejected",
    reasonForChange: reason,
  });

  return data as Appointment;
}

export async function updateStaffAppointment(
  admin: SupabaseClient,
  clinicId: string,
  appointmentId: string,
  input: {
    patient_name_ar?: string;
    patient_phone?: string;
    patient_id?: string | null;
    appointment_date?: string;
    start_time?: string;
    end_time?: string;
    notes?: string | null;
    reason_for_change: string;
  },
  audit?: AppointmentAuditActor
): Promise<Appointment> {
  const reason = input.reason_for_change?.trim();
  if (!reason) throw new Error("سبب التغيير مطلوب عند تعديل الموعد");

  const { data: current, error: fetchErr } = await admin
    .from("appointments")
    .select("*")
    .eq("id", appointmentId)
    .eq("clinic_id", clinicId)
    .maybeSingle();

  if (fetchErr || !current) throw new Error("الموعد غير موجود");

  const nextDate = input.appointment_date ?? (current.appointment_date as string);
  const nextStart = input.start_time ?? (current.start_time as string);
  const nextEnd = input.end_time ?? (current.end_time as string);

  await assertNoOverlapForDoctor(
    admin,
    clinicId,
    current.doctor_id as string,
    nextDate,
    nextStart,
    nextEnd,
    appointmentId
  );

  let patientId = (current.patient_id as string | null) ?? null;
  let patientName =
    input.patient_name_ar?.trim() ?? (current.patient_name_ar as string);
  let patientPhone =
    input.patient_phone?.trim() ?? (current.patient_phone as string | null);

  if (
    input.patient_id ||
    input.patient_name_ar ||
    input.patient_phone
  ) {
    const profile = await ensurePatientProfileForBooking(admin, clinicId, {
      name: patientName,
      phone: patientPhone,
      patientId: input.patient_id ?? patientId,
      primaryDoctorId: current.doctor_id as string,
    });
    patientId = profile.patientId;
    patientName = profile.name;
    patientPhone = profile.phone ?? patientPhone;
  }

  const { data, error } = await admin
    .from("appointments")
    .update({
      patient_id: patientId,
      patient_name_ar: patientName,
      patient_phone: patientPhone,
      appointment_date: nextDate,
      start_time: nextStart,
      end_time: nextEnd,
      notes: input.notes !== undefined ? input.notes : current.notes,
      reason_for_change: reason,
    })
    .eq("id", appointmentId)
    .select("*")
    .single();

  if (error) throw new Error(translateDbError(error.message));
  if (!data) throw new Error("تعذر تحديث الموعد");

  if (audit) {
    await writeAuditLog(admin, {
      clinicId,
      entityType: "appointment",
      entityId: appointmentId,
      action: "update",
      changedBy: audit.changedBy,
      actorName: audit.actorName,
      before: appointmentSnapshot(current as Record<string, unknown>),
      after: appointmentSnapshot(data as Record<string, unknown>),
      note: reason,
    });
  }

  const doctorName = await fetchDoctorName(admin, data.doctor_id as string);
  await sendAppointmentUpdate(admin, {
    clinicId,
    appointmentId: data.id as string,
    patientPhone: data.patient_phone as string,
    patientName: data.patient_name_ar as string,
    doctorName,
    appointmentDate: data.appointment_date as string,
    startTime: data.start_time as string,
    endTime: data.end_time as string,
    action: "modified",
    reasonForChange: reason,
  });

  return data as Appointment;
}

const DELETABLE_STATUSES = new Set([
  "pending",
  "scheduled",
  "confirmed",
  "waiting",
]);

/** إنشاء موعد يدوي — محاسب / مالك (مع اختيار الطبيب) */
export async function createStaffAppointment(
  admin: SupabaseClient,
  clinicId: string,
  input: {
    doctor_id: string;
    patient_name_ar: string;
    patient_phone: string;
    patient_id?: string | null;
    appointment_date: string;
    start_time: string;
    end_time: string;
    notes?: string | null;
  },
  audit?: AppointmentAuditActor
): Promise<{
  appointment: Appointment;
  whatsapp: SendAppointmentUpdateResult;
}> {
  const name = input.patient_name_ar.trim();
  if (!name) throw new Error("اسم المريض مطلوب");
  if (!input.patient_phone?.trim()) throw new Error("هاتف المريض مطلوب");
  const phoneCheck = validatePatientPhone(input.patient_phone);
  if (!phoneCheck.ok) throw new Error(phoneCheck.message);
  if (!input.doctor_id?.trim()) throw new Error("اختر الطبيب");

  const { data: doctor } = await admin
    .from("doctors")
    .select("id")
    .eq("id", input.doctor_id)
    .eq("clinic_id", clinicId)
    .eq("is_active", true)
    .maybeSingle();

  if (!doctor) throw new Error("الطبيب غير موجود في عيادتك");

  await assertNoOverlapForDoctor(
    admin,
    clinicId,
    input.doctor_id,
    input.appointment_date,
    input.start_time,
    input.end_time
  );

  const patientProfile = await ensurePatientProfileForBooking(admin, clinicId, {
    name,
    phone: phoneCheck.normalized,
    patientId: input.patient_id,
    primaryDoctorId: input.doctor_id,
  });

  const { data, error } = await admin
    .from("appointments")
    .insert({
      clinic_id: clinicId,
      doctor_id: input.doctor_id,
      assistant_id: null,
      patient_id: patientProfile.patientId,
      patient_name_ar: patientProfile.name,
      patient_phone: patientProfile.phone ?? phoneCheck.normalized,
      appointment_date: input.appointment_date,
      start_time: input.start_time,
      end_time: input.end_time,
      status: "confirmed",
      notes: input.notes?.trim() || null,
    })
    .select("*")
    .single();

  if (error) throw new Error(translateDbError(error.message));
  if (!data) throw new Error("تعذر إنشاء الموعد");

  if (audit) {
    await writeAuditLog(admin, {
      clinicId,
      entityType: "appointment",
      entityId: data.id as string,
      action: "create",
      changedBy: audit.changedBy,
      actorName: audit.actorName,
      after: appointmentSnapshot(data as Record<string, unknown>),
      note: `حجز جديد — ${input.patient_name_ar}`,
    });
  }

  const doctorName = await fetchDoctorName(admin, input.doctor_id);
  const whatsapp = await sendAppointmentUpdate(admin, {
    clinicId,
    appointmentId: data.id as string,
    patientPhone: data.patient_phone as string,
    patientName: data.patient_name_ar as string,
    doctorName,
    appointmentDate: data.appointment_date as string,
    startTime: data.start_time as string,
    endTime: data.end_time as string,
    action: "created",
  });

  return { appointment: data as Appointment, whatsapp };
}

/** إنشاء موعد — تطبيق الطبيب (مع واتساب للمراجع) */
export async function createDoctorAppointment(
  admin: SupabaseClient,
  clinicId: string,
  doctorId: string,
  input: {
    patient_name_ar: string;
    patient_phone: string;
    patient_id?: string | null;
    appointment_date: string;
    start_time: string;
    end_time: string;
    notes?: string | null;
  }
): Promise<{
  appointment: Appointment;
  whatsapp: SendAppointmentUpdateResult;
}> {
  const name = input.patient_name_ar.trim();
  if (!name) throw new Error("اسم المريض مطلوب");
  if (!input.patient_phone?.trim()) throw new Error("هاتف المريض مطلوب");
  const phoneCheck = validatePatientPhone(input.patient_phone);
  if (!phoneCheck.ok) throw new Error(phoneCheck.message);

  const { data: doctor } = await admin
    .from("doctors")
    .select("id")
    .eq("id", doctorId)
    .eq("clinic_id", clinicId)
    .eq("is_active", true)
    .maybeSingle();

  if (!doctor) throw new Error("حساب الطبيب غير مربوط بهذه العيادة");

  await assertNoOverlapForDoctor(
    admin,
    clinicId,
    doctorId,
    input.appointment_date,
    input.start_time,
    input.end_time
  );

  const patientProfile = await ensurePatientProfileForBooking(admin, clinicId, {
    name,
    phone: phoneCheck.normalized,
    patientId: input.patient_id,
    primaryDoctorId: doctorId,
  });

  const { data, error } = await admin
    .from("appointments")
    .insert({
      clinic_id: clinicId,
      doctor_id: doctorId,
      assistant_id: null,
      patient_id: patientProfile.patientId,
      patient_name_ar: patientProfile.name,
      patient_phone: patientProfile.phone ?? phoneCheck.normalized,
      appointment_date: input.appointment_date,
      start_time: input.start_time,
      end_time: input.end_time,
      status: "confirmed",
      notes: input.notes?.trim() || null,
    })
    .select("*")
    .single();

  if (error) throw new Error(translateDbError(error.message));
  if (!data) throw new Error("تعذر إنشاء الموعد");

  const doctorName = await fetchDoctorName(admin, doctorId);
  const whatsapp = await sendAppointmentUpdate(admin, {
    clinicId,
    appointmentId: data.id as string,
    patientPhone: data.patient_phone as string,
    patientName: data.patient_name_ar as string,
    doctorName,
    appointmentDate: data.appointment_date as string,
    startTime: data.start_time as string,
    endTime: data.end_time as string,
    action: "created",
  });

  return { appointment: data as Appointment, whatsapp };
}

/** حذف موعد — محاسب / مالك */
export async function deleteStaffAppointment(
  admin: SupabaseClient,
  clinicId: string,
  appointmentId: string,
  audit?: AppointmentAuditActor
): Promise<void> {
  const { data: current } = await admin
    .from("appointments")
    .select("*")
    .eq("id", appointmentId)
    .eq("clinic_id", clinicId)
    .maybeSingle();

  if (!current) throw new Error("الموعد غير موجود");

  if (!DELETABLE_STATUSES.has(current.status as string)) {
    throw new Error("لا يمكن حذف موعد مكتمل أو داخل الكشف");
  }

  const { error } = await admin
    .from("appointments")
    .delete()
    .eq("id", appointmentId);

  if (error) throw new Error(error.message);

  if (audit) {
    await writeAuditLog(admin, {
      clinicId,
      entityType: "appointment",
      entityId: appointmentId,
      action: "delete",
      changedBy: audit.changedBy,
      actorName: audit.actorName,
      before: appointmentSnapshot(current as Record<string, unknown>),
      note: `حذف موعد — ${(current.patient_name_ar as string) ?? "مراجع"}`,
    });
  }
}
