import type { SupabaseClient } from "@supabase/supabase-js";
import {
  normalizeDoctorPaymentType,
  parseSalaryAmount,
} from "@/lib/services/doctor-payment";

const PAYMENT_COLUMN_MARKERS = ["payment_type", "salary_amount"] as const;

export function isMissingDoctorPaymentColumnsError(message: string): boolean {
  const lower = message.toLowerCase();
  return PAYMENT_COLUMN_MARKERS.some((col) => lower.includes(col));
}

export function stripDoctorPaymentFields<T extends Record<string, unknown>>(
  row: T
): Omit<T, "payment_type" | "salary_amount"> {
  const { payment_type: _pt, salary_amount: _sa, ...rest } = row;
  return rest;
}

export function buildDoctorPaymentFields(
  paymentTypeRaw: unknown,
  salaryAmountRaw: unknown
): { payment_type: "percentage" | "salary"; salary_amount: number } {
  const payment_type = normalizeDoctorPaymentType(paymentTypeRaw);
  const salary_amount =
    payment_type === "salary" ? parseSalaryAmount(salaryAmountRaw) : 0;
  return { payment_type, salary_amount };
}

/** Insert doctor row — retries without payment columns if migration not applied yet */
export async function insertDoctorRow(
  admin: SupabaseClient,
  row: Record<string, unknown>
): Promise<{ error: string | null }> {
  const first = await admin.from("doctors").insert(row);
  if (!first.error) return { error: null };

  if (isMissingDoctorPaymentColumnsError(first.error.message)) {
    const retry = await admin.from("doctors").insert(stripDoctorPaymentFields(row));
    return { error: retry.error?.message ?? null };
  }

  return { error: first.error.message };
}

/** Update doctor row — retries without payment columns if migration not applied yet */
export async function updateDoctorRow(
  admin: SupabaseClient,
  doctorId: string,
  patch: Record<string, unknown>
): Promise<{ error: string | null }> {
  const first = await admin.from("doctors").update(patch).eq("id", doctorId);
  if (!first.error) return { error: null };

  if (isMissingDoctorPaymentColumnsError(first.error.message)) {
    const retry = await admin
      .from("doctors")
      .update(stripDoctorPaymentFields(patch))
      .eq("id", doctorId);
    return { error: retry.error?.message ?? null };
  }

  return { error: first.error.message };
}

/** Client-side insert payload — omits payment columns (use API when salary mode needed) */
export function buildClientDoctorInsertRow(input: {
  clinic_id: string;
  full_name_ar: string;
  specialty_ar: string | null;
  phone: string | null;
  percentage: string;
  materials_share: string;
  payment_type?: unknown;
  salary_amount?: number;
}): Record<string, unknown> {
  const base: Record<string, unknown> = {
    clinic_id: input.clinic_id,
    full_name_ar: input.full_name_ar,
    specialty_ar: input.specialty_ar,
    phone: input.phone,
    percentage: input.percentage,
    materials_share: input.materials_share,
  };

  const payment = buildDoctorPaymentFields(
    input.payment_type,
    input.salary_amount
  );
  return { ...base, ...payment };
}

export async function insertDoctorRowClient(
  supabase: SupabaseClient,
  row: Record<string, unknown>
): Promise<{ error: string | null }> {
  const first = await supabase.from("doctors").insert(row);
  if (!first.error) return { error: null };

  if (isMissingDoctorPaymentColumnsError(first.error.message)) {
    const retry = await supabase
      .from("doctors")
      .insert(stripDoctorPaymentFields(row));
    return { error: retry.error?.message ?? null };
  }

  return { error: first.error.message };
}
