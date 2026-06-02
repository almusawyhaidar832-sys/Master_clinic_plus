import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getAdminClient } from "@/lib/supabase/admin";
import { isStaffRole } from "@/lib/withdrawals/update-status-client";

export class StaffAccessError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
  }
}

export async function createApiSessionClient() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (cookiesToSet) => {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Route handlers may throw when setting cookies outside Server Action
          }
        },
      },
    }
  );
}

export async function getApiSessionUser() {
  const supabase = await createApiSessionClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

export async function getApiCallerProfile() {
  const user = await getApiSessionUser();
  if (!user) return null;

  const admin = getAdminClient();
  const { data: profile } = await admin
    .from("profiles")
    .select("id, role, clinic_id, full_name")
    .eq("id", user.id)
    .maybeSingle();

  return profile;
}

async function loadStaffProfile(userId: string) {
  const admin = getAdminClient();
  const { data: profile } = await admin
    .from("profiles")
    .select("id, role, clinic_id, full_name")
    .eq("id", userId)
    .maybeSingle();

  if (!profile) {
    throw new StaffAccessError(403, "لا يوجد ملف شخصي لحسابك");
  }

  if (!isStaffRole(profile.role)) {
    throw new StaffAccessError(
      403,
      `غير مصرح — دورك "${profile.role}" لا يسمح (المطلوب: محاسب أو مالك)`
    );
  }

  return profile;
}

/**
 * Verify logged-in user is accountant/owner and belongs to withdrawal clinic.
 * Update runs via service_role (bypasses RLS).
 */
export async function assertCanManageWithdrawal(withdrawalId: string) {
  const user = await getApiSessionUser();
  if (!user) {
    throw new StaffAccessError(401, "يجب تسجيل الدخول");
  }

  const admin = getAdminClient();
  const profile = await loadStaffProfile(user.id);

  const { data: withdrawal } = await admin
    .from("doctor_withdrawals")
    .select("id, clinic_id, status")
    .eq("id", withdrawalId)
    .maybeSingle();

  if (!withdrawal) {
    throw new StaffAccessError(404, "الطلب غير موجود");
  }

  if (
    profile.clinic_id &&
    String(profile.clinic_id) !== String(withdrawal.clinic_id)
  ) {
    throw new StaffAccessError(403, "غير مصرح — طلب من عيادة أخرى");
  }

  return { user, profile, withdrawal, admin };
}

/** Verify accountant/owner can record cash payment for a doctor */
export async function assertCanRecordCashWithdrawal(doctorId: string) {
  const user = await getApiSessionUser();
  if (!user) {
    throw new StaffAccessError(401, "يجب تسجيل الدخول");
  }

  const admin = getAdminClient();
  const profile = await loadStaffProfile(user.id);

  const { data: doctor } = await admin
    .from("doctors")
    .select("id, clinic_id, full_name_ar")
    .eq("id", doctorId)
    .maybeSingle();

  if (!doctor) {
    throw new StaffAccessError(404, "الطبيب غير موجود");
  }

  if (
    profile.clinic_id &&
    String(profile.clinic_id) !== String(doctor.clinic_id)
  ) {
    throw new StaffAccessError(403, "غير مصرح — طبيب من عيادة أخرى");
  }

  return { user, profile, doctor, admin };
}
