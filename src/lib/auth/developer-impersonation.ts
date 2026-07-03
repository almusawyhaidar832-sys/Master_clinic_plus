import "server-only";

import type { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  getDeveloperSessionFromRequest,
  getPlatformDeveloperEmail,
} from "@/lib/auth/developer-gate";
import { getDeveloperSessionFromCookies } from "@/lib/auth/developer-gate.server";
import { allAuthStorageKeys } from "@/lib/auth/portal-access";
import { getAdminClient } from "@/lib/supabase/admin";
import { createServerAuthClient } from "@/lib/supabase/create-auth-client";
import {
  getCurrentUser,
  signInWithPassword,
  signOutUser,
} from "@/lib/supabase/auth-helpers";

export type ImpersonationProfile = {
  id: string;
  role: string;
  clinic_id: string | null;
  full_name: string | null;
};

function envValue(key: string): string {
  return (process.env[key] ?? "").trim().replace(/\r$/, "");
}

export function getPlainDeveloperPassword(): string | null {
  const plain =
    envValue("PLATFORM_DEVELOPER_PASSWORD") || envValue("ADMIN_PASSWORD");
  return plain || null;
}

export async function resolveDeveloperActingClinicId(
  req?: NextRequest | Request
): Promise<string | null> {
  if (req && "cookies" in req) {
    const fromReq = await getDeveloperSessionFromRequest(req as NextRequest);
    if (fromReq?.actingClinicId) return fromReq.actingClinicId;
  }
  const fromCookies = await getDeveloperSessionFromCookies();
  return fromCookies?.actingClinicId ?? null;
}

export function overlayActingClinic<T extends { clinic_id: string | null }>(
  profile: T,
  actingClinicId: string | null
): T {
  if (!actingClinicId) return profile;
  return { ...profile, clinic_id: actingClinicId };
}

export async function loadPlatformAdminProfile(
  admin: SupabaseClient
): Promise<ImpersonationProfile | null> {
  const devEmail = getPlatformDeveloperEmail();
  if (!devEmail) return null;

  const { data: authList } = await admin.auth.admin.listUsers({
    page: 1,
    perPage: 500,
  });
  const authUser = authList?.users?.find(
    (u) => u.email?.toLowerCase() === devEmail
  );
  if (!authUser) return null;

  const { data: profile } = await admin
    .from("profiles")
    .select("id, role, clinic_id, full_name")
    .eq("id", authUser.id)
    .maybeSingle();

  if (profile) return profile as ImpersonationProfile;

  return {
    id: authUser.id,
    role: "accountant",
    clinic_id: null,
    full_name: "Platform Admin",
  };
}

export async function bindPlatformAdminToClinic(
  admin: SupabaseClient,
  clinicId: string
): Promise<{ ok: true; userId: string } | { ok: false; error: string }> {
  const devEmail = getPlatformDeveloperEmail();
  if (!devEmail) {
    return { ok: false, error: "ADMIN_EMAIL غير مضبوط" };
  }

  const plainPassword = getPlainDeveloperPassword();

  const { data: authList } = await admin.auth.admin.listUsers({
    page: 1,
    perPage: 500,
  });
  let authUser = authList?.users?.find(
    (u) => u.email?.toLowerCase() === devEmail
  );

  if (!authUser) {
    if (!plainPassword) {
      return {
        ok: false,
        error:
          "لا يوجد حساب Supabase للمطور — أضف PLATFORM_DEVELOPER_PASSWORD في .env",
      };
    }
    const { data: created, error: createErr } =
      await admin.auth.admin.createUser({
        email: devEmail,
        password: plainPassword,
        email_confirm: true,
        user_metadata: { full_name: "Platform Admin" },
      });
    if (createErr || !created.user) {
      return {
        ok: false,
        error: createErr?.message ?? "فشل إنشاء حساب المطور في Supabase",
      };
    }
    authUser = created.user;
  }

  const { error: profileErr } = await admin.from("profiles").upsert({
    id: authUser.id,
    clinic_id: clinicId,
    role: "accountant",
    full_name: "Platform Admin",
    is_active: true,
  });

  if (profileErr) {
    return { ok: false, error: profileErr.message };
  }

  return { ok: true, userId: authUser.id };
}

function clearPortalAuthCookies(): {
  name: string;
  value: string;
  options?: object;
}[] {
  return allAuthStorageKeys().map((storageKey) => ({
    name: storageKey,
    value: "",
    options: { path: "/", maxAge: 0 },
  }));
}

/**
 * يفصل جلسة المحاسب/الطبيب القديمة ويفتح جلسة المطور على بوابة المحاسب
 * حتى RLS وواجهة الداشبورد تعرض العيادة المختارة فقط.
 */
export async function establishImpersonationDashboardSession(
  request: NextRequest,
  clinicId: string
): Promise<
  | { ok: true; cookies: { name: string; value: string; options?: object }[] }
  | { ok: false; error: string }
> {
  const admin = getAdminClient();
  const bind = await bindPlatformAdminToClinic(admin, clinicId);
  if (!bind.ok) return bind;

  const devEmail = getPlatformDeveloperEmail();
  const plainPassword = getPlainDeveloperPassword();
  if (!plainPassword) {
    return {
      ok: false,
      error:
        "أضف PLATFORM_DEVELOPER_PASSWORD في .env لتفعيل الدخول النيابي الصحيح",
    };
  }

  const sessionCookies: {
    name: string;
    value: string;
    options?: object;
  }[] = [];

  const cookieStore = {
    getAll: () => request.cookies.getAll(),
    setAll: (
      cookiesToSet: { name: string; value: string; options?: object }[]
    ) => {
      sessionCookies.push(...cookiesToSet);
    },
  };

  const anyClient = createServerAuthClient(cookieStore, "default");
  const legacyClient = createServerAuthClient(cookieStore, "accountant");
  const currentUser =
    (await getCurrentUser(anyClient)) ?? (await getCurrentUser(legacyClient));

  const cookiesToApply: {
    name: string;
    value: string;
    options?: object;
  }[] = [];

  if (
    currentUser &&
    currentUser.email?.toLowerCase() !== devEmail.toLowerCase()
  ) {
    cookiesToApply.push(...clearPortalAuthCookies());
  }

  const supabase = createServerAuthClient(cookieStore, "accountant");
  await signOutUser(supabase);

  const { data, error } = await signInWithPassword(
    supabase,
    devEmail,
    plainPassword
  );

  if (error || !data.user) {
    return {
      ok: false,
      error:
        error?.message ??
        "تعذر فتح جلسة المطور — تأكد أن كلمة مرور Supabase تطابق PLATFORM_DEVELOPER_PASSWORD",
    };
  }

  cookiesToApply.push(...sessionCookies);

  return { ok: true, cookies: cookiesToApply };
}
