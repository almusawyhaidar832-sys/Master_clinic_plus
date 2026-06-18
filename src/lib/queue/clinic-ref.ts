import "server-only";

import { isUuid } from "@/lib/booking/urls";
import { getAdminClient } from "@/lib/supabase/admin";

export interface ResolvedQueueClinic {
  id: string;
  name: string;
  bookingCode: string | null;
}

/** يحوّل معرّف العيادة (UUID أو رمز الحجز القصير) لسجل العيادة */
export async function resolveActiveClinicByRef(
  clinicRef: string
): Promise<ResolvedQueueClinic | null> {
  const ref = clinicRef.trim();
  if (!ref) return null;

  const admin = getAdminClient();

  let query = admin
    .from("clinics")
    .select("id, name, name_ar, booking_code, is_active")
    .eq("is_active", true);

  query = isUuid(ref) ? query.eq("id", ref) : query.ilike("booking_code", ref);

  const { data: clinic, error } = await query.maybeSingle();
  if (error) throw new Error(error.message);
  if (!clinic) return null;

  return {
    id: clinic.id as string,
    name: (clinic.name_ar as string) || (clinic.name as string) || "العيادة",
    bookingCode: (clinic.booking_code as string | null) ?? null,
  };
}

export function buildQueueScreenUrl(
  clinicRef: string,
  origin?: string
): string {
  const base =
    origin ??
    (typeof window !== "undefined" ? window.location.origin : "");
  return `${base}/queue-screen?clinic=${encodeURIComponent(clinicRef.trim())}`;
}
