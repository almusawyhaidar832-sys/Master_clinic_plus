import type { SupabaseClient } from "@supabase/supabase-js";
import {
  isValidSanitizedUsername,
  sanitizeUsername,
  usernameToAuthEmail,
} from "@/lib/auth/credentials";
import { getAuthAdmin } from "@/lib/supabase/auth-helpers";
import type { UserRole } from "@/types";

export type DeveloperClinicUserRow = {
  id: string;
  full_name: string | null;
  username: string | null;
  role: UserRole;
  is_active: boolean;
  clinic_id: string | null;
  login_email: string | null;
  last_sign_in_at: string | null;
  created_at: string;
  doctor_id: string | null;
};

const ROLE_LABELS: Record<UserRole, string> = {
  super_admin: "مالك العيادة",
  accountant: "محاسب",
  doctor: "طبيب",
  assistant: "مساعد طبيب",
};

export function developerRoleLabel(role: string): string {
  return ROLE_LABELS[role as UserRole] ?? role;
}

export const DEVELOPER_ASSIGNABLE_ROLES: UserRole[] = [
  "super_admin",
  "accountant",
  "doctor",
];

export async function fetchClinicUsersForDeveloper(
  admin: SupabaseClient,
  clinicId: string
): Promise<DeveloperClinicUserRow[]> {
  const { data: profiles } = await admin
    .from("profiles")
    .select("id, full_name, username, role, is_active, clinic_id, created_at")
    .eq("clinic_id", clinicId)
    .order("created_at", { ascending: true });

  const { data: doctors } = await admin
    .from("doctors")
    .select("id, profile_id")
    .eq("clinic_id", clinicId);

  const doctorByProfile = new Map<string, string>();
  for (const d of doctors ?? []) {
    if (d.profile_id) doctorByProfile.set(String(d.profile_id), String(d.id));
  }

  const authAdmin = getAuthAdmin(admin);
  const rows: DeveloperClinicUserRow[] = [];

  for (const p of profiles ?? []) {
    let loginEmail: string | null = null;
    let lastSignIn: string | null = null;

    try {
      const { data: authUser } = await authAdmin.getUserById(String(p.id));
      loginEmail = authUser?.user?.email ?? null;
      const meta = authUser?.user as { last_sign_in_at?: string } | undefined;
      lastSignIn = meta?.last_sign_in_at ?? null;
    } catch {
      loginEmail = p.username
        ? usernameToAuthEmail(String(p.username))
        : null;
    }

    rows.push({
      id: String(p.id),
      full_name: p.full_name,
      username: p.username,
      role: (p.role ?? "accountant") as UserRole,
      is_active: p.is_active !== false,
      clinic_id: p.clinic_id,
      login_email: loginEmail,
      last_sign_in_at: lastSignIn,
      created_at: String(p.created_at ?? ""),
      doctor_id: doctorByProfile.get(String(p.id)) ?? null,
    });
  }

  return rows;
}

export async function updateClinicUserForDeveloper(
  admin: SupabaseClient,
  clinicId: string,
  userId: string,
  input: {
    role?: UserRole;
    is_active?: boolean;
    full_name?: string;
    new_password?: string;
  }
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data: profile } = await admin
    .from("profiles")
    .select("id, clinic_id, username")
    .eq("id", userId)
    .maybeSingle();

  if (!profile || profile.clinic_id !== clinicId) {
    return { ok: false, error: "المستخدم غير موجود في هذه العيادة" };
  }

  if (input.role && !DEVELOPER_ASSIGNABLE_ROLES.includes(input.role)) {
    return { ok: false, error: "دور غير مسموح" };
  }

  if (input.new_password) {
    if (input.new_password.length < 6) {
      return { ok: false, error: "كلمة المرور 6 أحرف على الأقل" };
    }
    const { error: passErr } = await getAuthAdmin(admin).updateUserById(
      userId,
      { password: input.new_password }
    );
    if (passErr) {
      return { ok: false, error: passErr.message };
    }
  }

  const patch: Record<string, unknown> = {};
  if (input.role !== undefined) patch.role = input.role;
  if (input.is_active !== undefined) patch.is_active = input.is_active;
  if (input.full_name !== undefined) patch.full_name = input.full_name.trim();

  if (Object.keys(patch).length > 0) {
    const { error } = await admin
      .from("profiles")
      .update(patch)
      .eq("id", userId)
      .eq("clinic_id", clinicId);
    if (error) return { ok: false, error: error.message };
  }

  return { ok: true };
}

export async function createClinicUserForDeveloper(
  admin: SupabaseClient,
  clinicId: string,
  input: {
    full_name: string;
    username: string;
    password: string;
    role: UserRole;
  }
): Promise<{ ok: true; userId: string } | { ok: false; error: string }> {
  const safeUsername = sanitizeUsername(input.username);
  if (!isValidSanitizedUsername(safeUsername)) {
    return {
      ok: false,
      error: "اسم المستخدم: 3–32 حرفاً إنجليزياً (a-z، أرقام، . _ -)",
    };
  }
  if (!input.password || input.password.length < 6) {
    return { ok: false, error: "كلمة المرور 6 أحرف على الأقل" };
  }
  if (!DEVELOPER_ASSIGNABLE_ROLES.includes(input.role)) {
    return { ok: false, error: "دور غير مسموح" };
  }

  const { data: taken } = await admin
    .from("profiles")
    .select("id")
    .eq("username", safeUsername)
    .maybeSingle();
  if (taken) {
    return { ok: false, error: "اسم المستخدم محجوز" };
  }

  const authEmail = usernameToAuthEmail(safeUsername);
  const { data: authData, error: authErr } = await getAuthAdmin(admin).createUser(
    {
      email: authEmail,
      password: input.password,
      email_confirm: true,
      user_metadata: {
        full_name: input.full_name.trim(),
        username: safeUsername,
      },
    }
  );

  if (authErr || !authData.user) {
    return { ok: false, error: authErr?.message ?? "فشل إنشاء الحساب" };
  }

  const { error: profileErr } = await admin.from("profiles").insert({
    id: authData.user.id,
    clinic_id: clinicId,
    role: input.role,
    full_name: input.full_name.trim(),
    username: safeUsername,
    is_active: true,
  });

  if (profileErr) {
    await getAuthAdmin(admin).deleteUser(authData.user.id);
    return { ok: false, error: profileErr.message };
  }

  return { ok: true, userId: authData.user.id };
}
