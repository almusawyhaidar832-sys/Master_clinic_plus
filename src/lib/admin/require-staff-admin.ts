import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { getApiCallerProfile } from "@/lib/auth/api-session";
import { isApiStaffRole } from "@/lib/auth/api-portal";
import { normalizeRole } from "@/lib/auth/portal-access";
import { getAdminClient } from "@/lib/supabase/admin";

export type StaffAdminContext = {
  admin: SupabaseClient;
  callerId: string;
  role: "accountant" | "super_admin";
  clinicId: string | null;
};

export async function requireStaffAdmin(
  req?: Request
): Promise<StaffAdminContext | { error: string; status: number }> {
  const profile = await getApiCallerProfile(req);
  if (!profile) {
    return { error: "يجب تسجيل الدخول أولاً", status: 401 };
  }

  if (!isApiStaffRole(profile.role)) {
    return { error: "لا تملك صلاحية إدارة الأطباء", status: 403 };
  }

  const normalizedRole = normalizeRole(profile.role);
  const staffRole: StaffAdminContext["role"] =
    normalizedRole === "super_admin" ? "super_admin" : "accountant";

  let admin: SupabaseClient;
  try {
    admin = getAdminClient();
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "SUPABASE_SERVICE_ROLE_KEY غير مضبوط في .env.local",
      status: 500,
    };
  }

  return {
    admin,
    callerId: profile.id,
    role: staffRole,
    clinicId: profile.clinic_id ?? null,
  };
}
