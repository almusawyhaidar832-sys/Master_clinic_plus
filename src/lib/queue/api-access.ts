import "server-only";

import {
  createApiSessionClient,
  getApiCallerProfile,
  getApiSessionUser,
  isApiDoctorRole,
  isApiAssistantRole,
  isApiStaffRole,
} from "@/lib/auth/api-session";
import { getActiveClinicIdServer } from "@/lib/clinic-context.server";
import { getDoctorByProfileId } from "@/lib/queue/server";

export type QueueApiAccess =
  | {
      ok: true;
      profile: {
        id: string;
        role: string | null;
        clinic_id: string;
        full_name: string | null;
      };
      clinicId: string;
    }
  | { ok: false; status: number; error: string };

/** Resolve authenticated staff/doctor/assistant context for queue API routes. */
export async function resolveQueueApiAccess(req: Request): Promise<QueueApiAccess> {
  const user = await getApiSessionUser(req);
  if (!user) {
    return { ok: false, status: 401, error: "يجب تسجيل الدخول" };
  }

  const profile = await getApiCallerProfile(req);
  if (!profile) {
    return {
      ok: false,
      status: 403,
      error: "لم يتم العثور على ملف حسابك — تواصل مع الإدارة",
    };
  }

  let clinicId = profile.clinic_id?.trim() || null;
  let resolvedRole = profile.role;
  const doctorRow = await getDoctorByProfileId(profile.id);

  if (!clinicId && doctorRow?.clinic_id) {
    clinicId = String(doctorRow.clinic_id).trim();
  }
  if (!clinicId && isApiDoctorRole(resolvedRole)) {
    clinicId = (doctorRow?.clinic_id as string | undefined)?.trim() || null;
  }
  if (
    doctorRow &&
    !isApiDoctorRole(resolvedRole) &&
    !isApiAssistantRole(resolvedRole) &&
    !isApiStaffRole(resolvedRole)
  ) {
    resolvedRole = "doctor";
  }
  if (!clinicId) {
    const supabase = await createApiSessionClient(req);
    const active = await getActiveClinicIdServer(supabase);
    clinicId = active?.clinicId ?? null;
  }

  if (!clinicId) {
    return {
      ok: false,
      status: 403,
      error: "حسابك غير مربوط بعيادة — تواصل مع المدير لربط حسابك",
    };
  }

  return {
    ok: true,
    clinicId,
    profile: {
      id: profile.id,
      role: resolvedRole,
      clinic_id: clinicId,
      full_name: profile.full_name,
    },
  };
}
