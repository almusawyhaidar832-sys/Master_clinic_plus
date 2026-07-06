import type { SupabaseClient } from "@supabase/supabase-js";
import {
  patientPhoneColumns,
  validatePatientPhone,
} from "@/lib/phone";

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

/** بحث ملف موجود — بالهاتف أولاً ثم الاسم (يمنع تكرار الملفات) */
export async function resolveExistingPatientId(
  supabase: SupabaseClient,
  clinicId: string,
  input: { name?: string | null; phone?: string | null }
): Promise<string | null> {
  const phone = input.phone?.trim();
  if (phone) {
    const byPhone = await findPatientIdByPhone(supabase, clinicId, phone);
    if (byPhone) return byPhone;
  }

  const name = input.name?.trim();
  if (name) {
    return findPatientIdByName(supabase, clinicId, name);
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
