import { getApiSessionUser } from "@/lib/auth/api-session";
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
export async function assertCanManageWithdrawal(
  withdrawalId: string,
  req?: Request
) {
  const user = await getApiSessionUser(req);
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
    !profile.clinic_id ||
    String(profile.clinic_id) !== String(withdrawal.clinic_id)
  ) {
    throw new StaffAccessError(403, "غير مصرح — طلب من عيادة أخرى");
  }

  return { user, profile, withdrawal, admin };
}

/** Verify accountant/owner can record cash payment for a doctor */
export async function assertCanRecordCashWithdrawal(
  doctorId: string,
  req?: Request
) {
  const user = await getApiSessionUser(req);
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
    !profile.clinic_id ||
    String(profile.clinic_id) !== String(doctor.clinic_id)
  ) {
    throw new StaffAccessError(403, "غير مصرح — طبيب من عيادة أخرى");
  }

  return { user, profile, doctor, admin };
}

/** Verify accountant/owner can manage clinic finances (top-up, etc.) */
export async function assertCanManageClinicFinance(req?: Request) {
  const user = await getApiSessionUser(req);
  if (!user) {
    throw new StaffAccessError(401, "يجب تسجيل الدخول");
  }

  const admin = getAdminClient();
  const profile = await loadStaffProfile(user.id);

  if (!profile.clinic_id) {
    throw new StaffAccessError(400, "حسابك غير مربوط بعيادة");
  }

  if (!["accountant", "super_admin"].includes(String(profile.role ?? ""))) {
    throw new StaffAccessError(403, "صلاحيات غير كافية");
  }

  return { user, profile, admin, clinicId: profile.clinic_id as string };
}
