import type { SupabaseClient } from "@supabase/supabase-js";
import {
  getPatientDisplayPhone,
  patientPhoneColumns,
  validatePatientPhone,
} from "@/lib/phone";
import { todayISO } from "@/lib/utils";

export function normalizePatientNameForMatch(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

export function patientPhoneDigits(phone: string | null | undefined): string {
  return (phone ?? "").replace(/\D/g, "");
}

export async function findPatientIdByPhone(
  supabase: SupabaseClient,
  clinicId: string,
  phone: string
): Promise<string | null> {
  const digits = patientPhoneDigits(phone);
  if (digits.length < 8) return null;

  const { data } = await supabase
    .from("patients")
    .select("id")
    .eq("clinic_id", clinicId)
    .or(`phone.ilike.%${digits}%,phone_number.ilike.%${digits}%`)
    .limit(1)
    .maybeSingle();

  return (data?.id as string | undefined) ?? null;
}

export async function findPatientIdByName(
  supabase: SupabaseClient,
  clinicId: string,
  name: string
): Promise<string | null> {
  const trimmed = name.trim();
  if (!trimmed) return null;

  const { data } = await supabase
    .from("patients")
    .select("id")
    .eq("clinic_id", clinicId)
    .eq("full_name_ar", trimmed)
    .limit(1)
    .maybeSingle();

  return (data?.id as string | undefined) ?? null;
}

/**
 * بحث ملف موجود — بالاسم فقط عند وجود اسم.
 * لا نربط بالهاتف وحده: العائلة قد تشترك برقم واحد وأسماء مختلفة.
 */
export async function resolveExistingPatientId(
  supabase: SupabaseClient,
  clinicId: string,
  input: { name?: string | null; phone?: string | null }
): Promise<string | null> {
  const name = input.name?.trim();
  if (name) {
    return findPatientIdByName(supabase, clinicId, name);
  }

  const phone = input.phone?.trim();
  if (phone) {
    return findPatientIdByPhone(supabase, clinicId, phone);
  }

  return null;
}

/** عند الحجز — ربط ملف موجود أو إنشاء واحد فقط */
export async function ensurePatientIdForBooking(
  supabase: SupabaseClient,
  clinicId: string,
  input: {
    name: string;
    phone?: string | null;
    primaryDoctorId?: string | null;
  }
): Promise<string> {
  const name = input.name.trim();
  if (!name) throw new Error("اسم المريض مطلوب");

  const existing = await resolveExistingPatientId(supabase, clinicId, {
    name,
    phone: input.phone,
  });
  if (existing) return existing;

  const phoneRaw = input.phone?.trim() ?? "";
  const phoneCheck = phoneRaw ? validatePatientPhone(phoneRaw) : null;
  const insertPayload: Record<string, unknown> = {
    clinic_id: clinicId,
    full_name_ar: name,
  };

  if (input.primaryDoctorId) {
    insertPayload.primary_doctor_id = input.primaryDoctorId;
  }

  if (phoneCheck?.ok) {
    Object.assign(insertPayload, patientPhoneColumns(phoneCheck.normalized));
  } else if (phoneRaw) {
    insertPayload.phone = phoneRaw;
  }

  const { data: created, error } = await supabase
    .from("patients")
    .insert(insertPayload)
    .select("id")
    .single();

  if (error || !created?.id) {
    throw new Error(error?.message ?? "تعذر إنشاء ملف المريض");
  }

  return created.id as string;
}

export type PatientBookingProfile = {
  patientId: string;
  name: string;
  phone: string | null;
};

async function loadPatientBookingProfile(
  supabase: SupabaseClient,
  clinicId: string,
  patientId: string
): Promise<PatientBookingProfile | null> {
  const { data } = await supabase
    .from("patients")
    .select("id, clinic_id, full_name_ar, phone, phone_number")
    .eq("id", patientId)
    .maybeSingle();

  if (!data || String(data.clinic_id) !== clinicId) return null;

  return {
    patientId: data.id as string,
    name: String(data.full_name_ar ?? "").trim() || "مراجع",
    phone: getPatientDisplayPhone(
      data as { phone?: string | null; phone_number?: string | null }
    ),
  };
}

/**
 * عند الحجز — يربط ملفاً موجوداً ويُرجع الاسم/الهاتف من السجل (بعد أي تعديل).
 */
export async function ensurePatientProfileForBooking(
  supabase: SupabaseClient,
  clinicId: string,
  input: {
    name: string;
    phone?: string | null;
    patientId?: string | null;
    primaryDoctorId?: string | null;
  }
): Promise<PatientBookingProfile> {
  const name = input.name.trim();
  if (!name) throw new Error("اسم المريض مطلوب");

  const selectedId = input.patientId?.trim();
  if (selectedId) {
    const selected = await loadPatientBookingProfile(
      supabase,
      clinicId,
      selectedId
    );
    if (selected) return selected;
  }

  const existingId = await resolveExistingPatientId(supabase, clinicId, {
    name,
    phone: input.phone,
  });
  if (existingId) {
    const existing = await loadPatientBookingProfile(
      supabase,
      clinicId,
      existingId
    );
    if (existing) return existing;
  }

  const phoneRaw = input.phone?.trim() ?? "";
  const phoneCheck = phoneRaw ? validatePatientPhone(phoneRaw) : null;
  const newId = await ensurePatientIdForBooking(supabase, clinicId, {
    name,
    phone: phoneCheck?.ok ? phoneCheck.normalized : phoneRaw || null,
    primaryDoctorId: input.primaryDoctorId,
  });

  const created = await loadPatientBookingProfile(supabase, clinicId, newId);
  if (created) return created;

  throw new Error("تعذر تحميل ملف المراجع بعد الحجز");
}

/** بعد تعديل اسم/هاتف المراجع — تحديث المواعيد والطابور المفتوح */
export async function syncPatientIdentitySnapshots(
  supabase: SupabaseClient,
  patientId: string,
  input: { name: string; phone?: string | null }
): Promise<void> {
  const name = input.name.trim();
  if (!name) return;

  const today = todayISO();
  const apptPayload: Record<string, unknown> = { patient_name_ar: name };
  const queuePayload: Record<string, unknown> = { patient_name: name };

  if (input.phone !== undefined) {
    apptPayload.patient_phone = input.phone;
    queuePayload.patient_phone = input.phone;
  }

  await supabase
    .from("appointments")
    .update(apptPayload)
    .eq("patient_id", patientId)
    .gte("appointment_date", today)
    .neq("status", "cancelled")
    .neq("status", "completed");

  await supabase
    .from("patient_queue")
    .update(queuePayload)
    .eq("patient_id", patientId)
    .gte("queue_date", today)
    .neq("status", "done")
    .neq("status", "cancelled");
}
