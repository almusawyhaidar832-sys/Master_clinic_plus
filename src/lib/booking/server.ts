import "server-only";

import { getAdminClient } from "@/lib/supabase/admin";
import { isUuid } from "@/lib/booking/urls";
import type {
  PublicClinicSummary,
  ResolvedBookingClinic,
} from "@/lib/booking/types";

export type {
  PublicClinicSummary,
  PublicDoctorOption,
  ResolvedBookingClinic,
} from "@/lib/booking/types";

function hasOnlineBooking(modules: unknown): boolean {
  if (!Array.isArray(modules)) return false;
  return modules.includes("online_booking");
}

/** List active clinics with online booking enabled. */
export async function listBookableClinics(): Promise<PublicClinicSummary[]> {
  const admin = getAdminClient();

  const { data: clinics, error } = await admin
    .from("clinics")
    .select("id, name, name_ar, address, phone, logo_url, booking_code, is_active")
    .eq("is_active", true)
    .not("booking_code", "is", null)
    .order("name_ar");

  if (error) throw new Error(error.message);
  if (!clinics?.length) return [];

  const ids = clinics.map((c) => c.id as string);
  const { data: settings } = await admin
    .from("clinic_settings")
    .select("clinic_id, enabled_modules")
    .in("clinic_id", ids);

  const modulesByClinic = new Map<string, unknown>();
  for (const row of settings ?? []) {
    modulesByClinic.set(row.clinic_id as string, row.enabled_modules);
  }

  return clinics
    .filter((c) => hasOnlineBooking(modulesByClinic.get(c.id as string)))
    .map((c) => ({
      id: c.id as string,
      name: (c.name as string) || "عيادة",
      nameAr: (c.name_ar as string | null) ?? null,
      address: (c.address as string | null) ?? null,
      phone: (c.phone as string | null) ?? null,
      logoUrl: (c.logo_url as string | null) ?? null,
      bookingCode: c.booking_code as string,
    }));
}

/** Resolve clinic by booking_code or UUID; returns null if not bookable. */
export async function resolveBookingClinic(
  clinicRef: string
): Promise<ResolvedBookingClinic | null> {
  const ref = clinicRef.trim();
  if (!ref) return null;

  const admin = getAdminClient();

  let query = admin
    .from("clinics")
    .select("id, name, name_ar, address, phone, logo_url, booking_code, is_active")
    .eq("is_active", true);

  query = isUuid(ref)
    ? query.eq("id", ref)
    : query.ilike("booking_code", ref);

  const { data: clinic, error } = await query.maybeSingle();
  if (error) throw new Error(error.message);
  if (!clinic?.booking_code) return null;

  const { data: settings } = await admin
    .from("clinic_settings")
    .select("enabled_modules")
    .eq("clinic_id", clinic.id)
    .maybeSingle();

  if (!hasOnlineBooking(settings?.enabled_modules)) return null;

  const { data: doctors, error: docErr } = await admin
    .from("doctors")
    .select("id, full_name_ar, specialty_ar")
    .eq("clinic_id", clinic.id)
    .eq("is_active", true)
    .order("full_name_ar");

  if (docErr) throw new Error(docErr.message);

  return {
    id: clinic.id as string,
    name: (clinic.name as string) || "عيادة",
    nameAr: (clinic.name_ar as string | null) ?? null,
    address: (clinic.address as string | null) ?? null,
    phone: (clinic.phone as string | null) ?? null,
    logoUrl: (clinic.logo_url as string | null) ?? null,
    bookingCode: clinic.booking_code as string,
    doctors: (doctors ?? []).map((d) => ({
      id: d.id as string,
      fullNameAr: d.full_name_ar as string,
      specialtyAr: (d.specialty_ar as string | null) ?? null,
    })),
  };
}

export interface CreatePublicBookingInput {
  clinicRef: string;
  doctorId: string;
  patientName: string;
  patientPhone?: string | null;
  appointmentDate: string;
  startTime: string;
  endTime: string;
  notes?: string | null;
}

export interface CreatePublicBookingResult {
  appointmentId: string;
  clinicId: string;
  clinicName: string;
}

function timesOverlap(
  aStart: string,
  aEnd: string,
  bStart: string,
  bEnd: string
): boolean {
  return aStart < bEnd && bStart < aEnd;
}

/** Create appointment — clinic_id is always derived server-side from clinicRef. */
export async function createPublicBooking(
  input: CreatePublicBookingInput
): Promise<CreatePublicBookingResult> {
  const clinic = await resolveBookingClinic(input.clinicRef);
  if (!clinic) {
    throw new Error("العيادة غير متاحة للحجز عبر الإنترنت");
  }

  const doctor = clinic.doctors.find((d) => d.id === input.doctorId);
  if (!doctor) {
    throw new Error("الطبيب المحدد لا ينتمي لهذه العيادة");
  }

  const name = input.patientName.trim();
  if (name.length < 2) {
    throw new Error("يرجى إدخال اسم المريض");
  }

  const admin = getAdminClient();
  const clinicId = clinic.id;

  const { data: locks } = await admin
    .from("schedule_locks")
    .select("start_time, end_time")
    .eq("clinic_id", clinicId)
    .eq("doctor_id", input.doctorId)
    .eq("lock_date", input.appointmentDate);

  for (const lock of locks ?? []) {
    if (
      timesOverlap(
        input.startTime,
        input.endTime,
        lock.start_time as string,
        lock.end_time as string
      )
    ) {
      throw new Error("هذا الموعد غير متاح — الوقت محجوز لدى الطبيب");
    }
  }

  const { data: existing } = await admin
    .from("appointments")
    .select("start_time, end_time, status")
    .eq("clinic_id", clinicId)
    .eq("doctor_id", input.doctorId)
    .eq("appointment_date", input.appointmentDate)
    .neq("status", "cancelled");

  for (const appt of existing ?? []) {
    if (
      timesOverlap(
        input.startTime,
        input.endTime,
        appt.start_time as string,
        appt.end_time as string
      )
    ) {
      throw new Error("هذا الموعد محجوز مسبقاً — اختر وقتاً آخر");
    }
  }

  const { data: inserted, error } = await admin
    .from("appointments")
    .insert({
      clinic_id: clinicId,
      doctor_id: input.doctorId,
      patient_name_ar: name,
      patient_phone: input.patientPhone?.trim() || null,
      appointment_date: input.appointmentDate,
      start_time: input.startTime,
      end_time: input.endTime,
      status: "pending",
      notes: input.notes?.trim() || null,
    })
    .select("id, clinic_id")
    .single();

  if (error) throw new Error(error.message);

  return {
    appointmentId: inserted.id as string,
    clinicId: inserted.clinic_id as string,
    clinicName: clinic.nameAr || clinic.name,
  };
}

const BOOKING_CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function randomBookingCode(): string {
  let code = "";
  for (let i = 0; i < 8; i++) {
    code +=
      BOOKING_CODE_CHARS[
        Math.floor(Math.random() * BOOKING_CODE_CHARS.length)
      ];
  }
  return code;
}

/** Ensure booking_code exists for a clinic (dashboard). */
export async function ensureClinicBookingCode(
  clinicId: string
): Promise<string> {
  const admin = getAdminClient();

  const { data: clinic, error: selectErr } = await admin
    .from("clinics")
    .select("booking_code")
    .eq("id", clinicId)
    .maybeSingle();

  if (selectErr) {
    const msg = selectErr.message ?? "";
    if (msg.includes("booking_code")) {
      throw new Error(
        "عمود booking_code غير موجود — شغّل سكربت add-clinic-booking-code.sql في Supabase"
      );
    }
    throw new Error(msg);
  }

  if (clinic?.booking_code) return clinic.booking_code as string;

  let bookingCode: string | null = null;
  const { data: rpcCode, error: rpcErr } = await admin.rpc(
    "generate_booking_code"
  );
  if (!rpcErr && rpcCode) {
    bookingCode = rpcCode as string;
  }

  for (let attempt = 0; attempt < 8 && !bookingCode; attempt++) {
    bookingCode = randomBookingCode();
  }
  if (!bookingCode) {
    throw new Error("تعذر توليد رمز الحجز");
  }

  const { error } = await admin
    .from("clinics")
    .update({ booking_code: bookingCode })
    .eq("id", clinicId);

  if (error) {
    if (error.message.includes("booking_code")) {
      throw new Error(
        "عمود booking_code غير موجود — شغّل سكربت add-clinic-booking-code.sql في Supabase"
      );
    }
    throw new Error(error.message);
  }
  return bookingCode;
}
