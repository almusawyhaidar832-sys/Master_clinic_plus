import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { validatePatientPhone } from "@/lib/phone";
import { translateDbError } from "@/lib/db-errors";
import { ensurePatientProfileForBooking } from "@/lib/services/resolve-patient-id";
import {
  sendAppointmentUpdate,
  type SendAppointmentUpdateResult,
} from "@/lib/services/appointment-updates";
import {
  approvePendingAppointment,
  rejectPendingAppointment,
  updateStaffAppointment,
} from "@/lib/services/staff-appointments-server";
import { syncQueueFromAppointmentStatus } from "@/lib/services/appointment-queue-sync";
import type { Appointment } from "@/types";

function timesOverlap(
  aStart: string,
  aEnd: string,
  bStart: string,
  bEnd: string
): boolean {
  return aStart < bEnd && bStart < aEnd;
}

export interface AssistantContext {
  assistantId: string;
  clinicId: string;
  doctorId: string;
}

export async function resolveAssistantContext(
  admin: SupabaseClient,
  profileId: string
): Promise<AssistantContext | null> {
  const { data } = await admin
    .from("assistants")
    .select("id, clinic_id, doctor_id, is_active")
    .eq("profile_id", profileId)
    .eq("is_active", true)
    .maybeSingle();

  if (!data?.clinic_id || !data?.doctor_id) return null;

  return {
    assistantId: data.id as string,
    clinicId: data.clinic_id as string,
    doctorId: data.doctor_id as string,
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

async function assertNoOverlap(
  admin: SupabaseClient,
  ctx: AssistantContext,
  date: string,
  startTime: string,
  endTime: string,
  excludeId?: string
): Promise<void> {
  const { data: existing } = await admin
    .from("appointments")
    .select("id, start_time, end_time, status")
    .eq("clinic_id", ctx.clinicId)
    .eq("doctor_id", ctx.doctorId)
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

export async function createAssistantAppointment(
  admin: SupabaseClient,
  ctx: AssistantContext,
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

  await assertNoOverlap(
    admin,
    ctx,
    input.appointment_date,
    input.start_time,
    input.end_time
  );

  const patientProfile = await ensurePatientProfileForBooking(admin, ctx.clinicId, {
    name,
    phone: phoneCheck.normalized,
    patientId: input.patient_id,
    primaryDoctorId: ctx.doctorId,
  });

  const { data, error } = await admin
    .from("appointments")
    .insert({
      clinic_id: ctx.clinicId,
      doctor_id: ctx.doctorId,
      assistant_id: ctx.assistantId,
      patient_id: patientProfile.patientId,
      patient_name_ar: patientProfile.name,
      patient_phone: phoneCheck.normalized,
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

  const doctorName = await fetchDoctorName(admin, ctx.doctorId);
  const whatsapp = await sendAppointmentUpdate(admin, {
    clinicId: ctx.clinicId,
    appointmentId: data.id as string,
    patientPhone: phoneCheck.normalized,
    patientName: data.patient_name_ar as string,
    doctorName,
    appointmentDate: data.appointment_date as string,
    startTime: data.start_time as string,
    endTime: data.end_time as string,
    action: "created",
  });

  return { appointment: data as Appointment, whatsapp };
}

export async function updateAssistantAppointment(
  admin: SupabaseClient,
  ctx: AssistantContext,
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
  }
): Promise<Appointment> {
  const reason = input.reason_for_change?.trim();
  if (!reason) throw new Error("سبب التغيير مطلوب عند تعديل الموعد");

  const { data: current, error: fetchErr } = await admin
    .from("appointments")
    .select("*")
    .eq("id", appointmentId)
    .eq("clinic_id", ctx.clinicId)
    .eq("doctor_id", ctx.doctorId)
    .maybeSingle();

  if (fetchErr || !current) throw new Error("الموعد غير موجود");

  const nextDate = input.appointment_date ?? (current.appointment_date as string);
  const nextStart = input.start_time ?? (current.start_time as string);
  const nextEnd = input.end_time ?? (current.end_time as string);

  await assertNoOverlap(
    admin,
    ctx,
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
    const profile = await ensurePatientProfileForBooking(admin, ctx.clinicId, {
      name: patientName,
      phone: patientPhone,
      patientId: input.patient_id ?? patientId,
      primaryDoctorId: ctx.doctorId,
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

  const doctorName = await fetchDoctorName(admin, ctx.doctorId);
  await sendAppointmentUpdate(admin, {
    clinicId: ctx.clinicId,
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

export async function acceptAssistantAppointment(
  admin: SupabaseClient,
  ctx: AssistantContext,
  appointmentId: string
): Promise<Appointment> {
  const { data: current } = await admin
    .from("appointments")
    .select("id, doctor_id")
    .eq("id", appointmentId)
    .eq("clinic_id", ctx.clinicId)
    .eq("doctor_id", ctx.doctorId)
    .maybeSingle();

  if (!current) throw new Error("الموعد غير موجود");

  return approvePendingAppointment(admin, ctx.clinicId, appointmentId, {
    assistantId: ctx.assistantId,
  });
}

export async function rejectAssistantAppointment(
  admin: SupabaseClient,
  ctx: AssistantContext,
  appointmentId: string,
  reason_for_change: string
): Promise<Appointment> {
  const { data: current } = await admin
    .from("appointments")
    .select("id")
    .eq("id", appointmentId)
    .eq("clinic_id", ctx.clinicId)
    .eq("doctor_id", ctx.doctorId)
    .maybeSingle();

  if (!current) throw new Error("الموعد غير موجود");

  return rejectPendingAppointment(
    admin,
    ctx.clinicId,
    appointmentId,
    reason_for_change,
    { assistantId: ctx.assistantId }
  );
}

const DELETABLE_STATUSES = new Set(["cancelled"]);

const CANCELLABLE_STATUSES = new Set(["scheduled", "confirmed", "waiting"]);

/** إلغاء حجز مؤكد — المرحلة الأولى (يبقى في الجدول بحالة ملغي) */
export async function cancelAssistantAppointment(
  admin: SupabaseClient,
  ctx: AssistantContext,
  appointmentId: string
): Promise<Appointment> {
  const { data: current } = await admin
    .from("appointments")
    .select("*")
    .eq("id", appointmentId)
    .eq("clinic_id", ctx.clinicId)
    .eq("doctor_id", ctx.doctorId)
    .maybeSingle();

  if (!current) throw new Error("الموعد غير موجود");

  if (!CANCELLABLE_STATUSES.has(current.status as string)) {
    throw new Error("لا يمكن إلغاء موعد مكتمل أو داخل الكشف");
  }

  const { data, error } = await admin
    .from("appointments")
    .update({ status: "cancelled" })
    .eq("id", appointmentId)
    .eq("clinic_id", ctx.clinicId)
    .eq("doctor_id", ctx.doctorId)
    .in("status", [...CANCELLABLE_STATUSES])
    .select("*")
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) {
    throw new Error("تعذّر الإلغاء — تغيّرت حالة الموعد قبل الحفظ");
  }

  await syncQueueFromAppointmentStatus(
    admin,
    appointmentId,
    ctx.clinicId,
    "cancelled"
  );

  const doctorName = await fetchDoctorName(admin, ctx.doctorId);
  await sendAppointmentUpdate(admin, {
    clinicId: ctx.clinicId,
    appointmentId: data.id as string,
    patientPhone: data.patient_phone as string,
    patientName: data.patient_name_ar as string,
    doctorName,
    appointmentDate: data.appointment_date as string,
    startTime: data.start_time as string,
    endTime: data.end_time as string,
    action: "rejected",
    reasonForChange: "تم إلغاء الحجز من العيادة",
  });

  return data as Appointment;
}

/** حذف موعد — المرحلة الثانية (بعد الإلغاء فقط) */
export async function deleteAssistantAppointment(
  admin: SupabaseClient,
  ctx: AssistantContext,
  appointmentId: string
): Promise<void> {
  const { data: current } = await admin
    .from("appointments")
    .select("id, status")
    .eq("id", appointmentId)
    .eq("clinic_id", ctx.clinicId)
    .eq("doctor_id", ctx.doctorId)
    .maybeSingle();

  if (!current) throw new Error("الموعد غير موجود");

  if (!DELETABLE_STATUSES.has(current.status as string)) {
    throw new Error("يمكن حذف المواعيد الملغاة فقط — ألغِ الحجز أولاً");
  }

  const { error } = await admin
    .from("appointments")
    .delete()
    .eq("id", appointmentId);

  if (error) throw new Error(error.message);
}
