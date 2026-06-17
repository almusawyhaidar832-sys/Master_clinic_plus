import type { SupabaseClient } from "@supabase/supabase-js";
import {
  isValidSanitizedUsername,
  resolveEmailForUsername,
  sanitizeUsername,
} from "@/lib/auth/credentials";
import {
  isRoleAllowedForPath,
  loginPortalIdForRole,
  loginPortalToAuthPortalId,
  normalizeRole,
  type AuthPortalId,
} from "@/lib/auth/portal-access";
import { createServerAuthClient } from "@/lib/supabase/create-auth-client";
import { signInWithPassword, signOutUser } from "@/lib/supabase/auth-helpers";

type LoginCookieStore = {
  getAll: () => { name: string; value: string }[];
  setAll: (
    cookies: { name: string; value: string; options?: object }[]
  ) => void;
};

export interface PortalLoginInput {
  username: string;
  password: string;
  portal: string;
  destination: string;
}

export type PortalLoginResult =
  | { ok: true; redirect: string; role: string }
  | { ok: false; status: number; error: string };

async function resolveRoleAfterSignIn(
  supabase: SupabaseClient,
  userId: string
): Promise<string | null> {
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .maybeSingle();

  const fromProfile = normalizeRole(profile?.role as string | undefined);
  if (fromProfile) return fromProfile;

  const { data: rpcRole } = await supabase.rpc("get_my_role");
  return normalizeRole(rpcRole as string | undefined);
}

/** Server/client shared portal login — expects Supabase client with portal-scoped cookies. */
export async function performPortalLogin(
  supabase: SupabaseClient,
  input: PortalLoginInput
): Promise<PortalLoginResult> {
  const username = input.username.trim();
  const password = input.password;

  if (!username || !password) {
    return {
      ok: false,
      status: 400,
      error: "اسم المستخدم وكلمة المرور مطلوبان",
    };
  }

  const authPortal = loginPortalToAuthPortalId(input.portal);
  if (!authPortal) {
    return { ok: false, status: 400, error: "بوابة الدخول غير معروفة" };
  }

  if (
    !username.includes("@") &&
    !isValidSanitizedUsername(sanitizeUsername(username))
  ) {
    return {
      ok: false,
      status: 400,
      error:
        "اسم المستخدم غير صالح — استخدم حروفاً إنجليزية وأرقاماً فقط (مثل dr_ahmed)",
    };
  }

  const email = await resolveEmailForUsername(supabase, username);
  if (!email) {
    return { ok: false, status: 400, error: "أدخل اسم المستخدم" };
  }

  const { data, error } = await signInWithPassword(supabase, email, password);
  if (error || !data.user) {
    const msg = error?.message ?? "";
    if (msg.includes("Invalid login credentials")) {
      return {
        ok: false,
        status: 401,
        error:
          "اسم المستخدم أو كلمة المرور غير صحيحة. إذا كان حسابك قديماً، جرّب إدخال بريدك في حقل اسم المستخدم.",
      };
    }
    return { ok: false, status: 401, error: msg || "تعذر تسجيل الدخول" };
  }

  const role = await resolveRoleAfterSignIn(supabase, data.user.id);
  if (!role || !isRoleAllowedForPath(role, input.destination)) {
    await signOutUser(supabase);
    return {
      ok: false,
      status: 403,
      error: role
        ? "هذا الحساب لا يناسب هذه البوابة — استخدم البوابة الصحيحة لدورك"
        : "تعذر تحميل صلاحيات الحساب — تواصل مع الإدارة",
    };
  }

  return {
    ok: true,
    redirect: input.destination,
    role,
  };
}

/**
 * دخول موحّد — يتحقق من الحساب ثم يوجّه تلقائياً حسب الدور.
 */
export async function performUnifiedLogin(
  cookieStore: LoginCookieStore,
  input: { username: string; password: string }
): Promise<
  | (PortalLoginResult & { ok: true; portalId: string })
  | (PortalLoginResult & { ok: false })
> {
  const username = input.username.trim();
  const password = input.password;

  if (!username || !password) {
    return {
      ok: false,
      status: 400,
      error: "اسم المستخدم وكلمة المرور مطلوبان",
    };
  }

  if (
    !username.includes("@") &&
    !isValidSanitizedUsername(sanitizeUsername(username))
  ) {
    return {
      ok: false,
      status: 400,
      error:
        "اسم المستخدم غير صالح — استخدم حروفاً إنجليزية وأرقاماً فقط (مثل dr_ahmed)",
    };
  }

  const probeClient = createServerAuthClient(cookieStore, "default");
  const email = await resolveEmailForUsername(probeClient, username);
  if (!email) {
    return { ok: false, status: 400, error: "أدخل اسم المستخدم" };
  }

  const { data, error } = await signInWithPassword(probeClient, email, password);
  if (error || !data.user) {
    const msg = error?.message ?? "";
    if (msg.includes("Invalid login credentials")) {
      return {
        ok: false,
        status: 401,
        error:
          "اسم المستخدم أو كلمة المرور غير صحيحة. إذا كان حسابك قديماً، جرّب إدخال بريدك في حقل اسم المستخدم.",
      };
    }
    return { ok: false, status: 401, error: msg || "تعذر تسجيل الدخول" };
  }

  const role = await resolveRoleAfterSignIn(probeClient, data.user.id);
  await signOutUser(probeClient);

  const portalId = loginPortalIdForRole(role);
  const destination = portalId ? portalLoginDestination(portalId) : null;
  const authPortal = portalId ? loginPortalToAuthPortalId(portalId) : null;

  if (!role || !portalId || !destination || !authPortal) {
    return {
      ok: false,
      status: 403,
      error: "لا يوجد بوابة مناسبة لدور هذا الحساب — تواصل مع الإدارة",
    };
  }

  const portalClient = createServerAuthClient(cookieStore, authPortal);
  const result = await performPortalLogin(portalClient, {
    username,
    password,
    portal: portalId,
    destination,
  });

  if (!result.ok) {
    return result;
  }

  return {
    ...result,
    portalId,
  };
}

export function portalLoginDestination(portalId: string): string | null {
  const authPortal = loginPortalToAuthPortalId(portalId);
  if (!authPortal) return null;

  const destinations: Record<AuthPortalId, string> = {
    doctor: "/doctor",
    accountant: "/dashboard",
    admin: "/admin",
    assistant: "/assistant/dashboard",
  };

  return destinations[authPortal];
}
