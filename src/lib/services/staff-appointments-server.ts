import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { sendAppointmentUpdate } from "@/lib/services/appointment-updates";
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

/** موافقة على طلب باركود — pending → waiting + غرفة الانتظار */
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

  const updatePayload: Record<string, unknown> = {
    status: "waiting",
    reason_for_change: null,
  };
  if (opts?.assistantId) {
    updatePayload.assistant_id = opts.assistantId;
  }

  const { data, error } = await admin
    .from("appointments")
    .update(updatePayload)
    .eq("id", appointmentId)
    .select("*")
    .single();

  if (error || !data) throw new Error(error?.message ?? "تعذر الموافقة على الموعد");

  const queueId = await enqueueApprovedAppointment(admin, {
    id: data.id as string,
    clinic_id: data.clinic_id as string,
    doctor_id: data.doctor_id as string,
    patient_name_ar: data.patient_name_ar as string | null,
    patient_phone: data.patient_phone as string | null,
    patient_id: data.patient_id as string | null,
  });
  await notifyDoctorForApprovedAppointment(queueId);

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

  const { data, error } = await admin
    .from("appointments")
    .update(updatePayload)
    .eq("id", appointmentId)
    .select("*")
    .single();

  if (error || !data) throw new Error(error?.message ?? "تعذر رفض الموعد");

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

  const { data, error } = await admin
    .from("appointments")
    .update({
      patient_name_ar: input.patient_name_ar?.trim() ?? current.patient_name_ar,
      patient_phone: input.patient_phone?.trim() ?? current.patient_phone,
      appointment_date: nextDate,
      start_time: nextStart,
      end_time: nextEnd,
      notes: input.notes !== undefined ? input.notes : current.notes,
      reason_for_change: reason,
    })
    .eq("id", appointmentId)
    .select("*")
    .single();

  if (error || !data) throw new Error(error?.message ?? "تعذر تحديث الموعد");

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
    appointment_date: string;
    start_time: string;
    end_time: string;
    notes?: string | null;
  }
): Promise<Appointment> {
  const name = input.patient_name_ar.trim();
  if (!name) throw new Error("اسم المريض مطلوب");
  if (!input.patient_phone?.trim()) throw new Error("هاتف المريض مطلوب");
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

  const { data, error } = await admin
    .from("appointments")
    .insert({
      clinic_id: clinicId,
      doctor_id: input.doctor_id,
      assistant_id: null,
      patient_name_ar: name,
      patient_phone: input.patient_phone.trim(),
      appointment_date: input.appointment_date,
      start_time: input.start_time,
      end_time: input.end_time,
      status: "confirmed",
      notes: input.notes?.trim() || null,
    })
    .select("*")
    .single();

  if (error || !data) throw new Error(error?.message ?? "تعذر إنشاء الموعد");

  const doctorName = await fetchDoctorName(admin, input.doctor_id);
  await sendAppointmentUpdate(admin, {
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

  return data as Appointment;
}

/** حذف موعد — محاسب / مالك */
export async function deleteStaffAppointment(
  admin: SupabaseClient,
  clinicId: string,
  appointmentId: string
): Promise<void> {
  const { data: current } = await admin
    .from("appointments")
    .select("id, status")
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
}
