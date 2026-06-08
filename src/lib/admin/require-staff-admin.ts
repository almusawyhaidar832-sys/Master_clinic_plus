import "server-only";

import { createClient as createServiceClient } from "@supabase/supabase-js";
import { getApiCallerProfile } from "@/lib/auth/api-session";

export type StaffAdminContext = {
  admin: ReturnType<typeof createServiceClient>;
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

  if (!["accountant", "super_admin"].includes(profile.role)) {
    return { error: "لا تملك صلاحية إدارة الأطباء", status: 403 };
  }

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    return {
      error: "SUPABASE_SERVICE_ROLE_KEY غير مضبوط في .env.local",
      status: 500,
    };
  }

  const admin = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceKey,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  return {
    admin,
    callerId: profile.id,
    role: profile.role as "accountant" | "super_admin",
    clinicId: profile.clinic_id ?? null,
  };
}
