import type { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getApiCallerProfile } from "@/lib/auth/api-session";
import { getAdminClient } from "@/lib/supabase/admin";

export interface ResolvedDoctorApiContext {
  profileId: string;
  clinicId: string;
  doctorId: string;
  admin: SupabaseClient;
}

/** يتحقق من جلسة الطبيب ويرجع سجل الطبيب النشط */
export async function resolveDoctorFromApiRequest(
  req: NextRequest
): Promise<
  | { ok: true; ctx: ResolvedDoctorApiContext }
  | { ok: false; status: number; error: string }
> {
  const profile = await getApiCallerProfile(req);
  if (!profile?.clinic_id) {
    return { ok: false, status: 401, error: "غير مصرح" };
  }

  const role = String(profile.role ?? "").toLowerCase();
  if (role !== "doctor") {
    return { ok: false, status: 403, error: "للأطباء فقط" };
  }

  const admin = getAdminClient();
  const { data: doctor } = await admin
    .from("doctors")
    .select("id, clinic_id")
    .eq("profile_id", profile.id)
    .eq("is_active", true)
    .maybeSingle();

  if (!doctor || doctor.clinic_id !== profile.clinic_id) {
    return { ok: false, status: 404, error: "لم يُربط حسابك بسجل طبيب" };
  }

  return {
    ok: true,
    ctx: {
      profileId: profile.id,
      clinicId: profile.clinic_id,
      doctorId: doctor.id,
      admin,
    },
  };
}
