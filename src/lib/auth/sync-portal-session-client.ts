"use client";

import { resolveEmailForUsername } from "@/lib/auth/credentials";
import {
  loginPortalToAuthPortalId,
  type AuthPortalId,
} from "@/lib/auth/portal-access";
import { getSession, signInWithPassword } from "@/lib/supabase/auth-helpers";
import { createClientForPortal } from "@/lib/supabase/client";

/**
 * Writes the Supabase session in the current browser/PWA context.
 * Required on iOS standalone apps where Set-Cookie from fetch may not persist.
 */
export async function syncPortalSessionClient(
  portalId: string,
  username: string,
  password: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const authPortal = loginPortalToAuthPortalId(portalId);
  if (!authPortal) {
    return { ok: false, error: "بوابة الدخول غير معروفة" };
  }

  const supabase = createClientForPortal(authPortal);

  // Server login already set portal cookies — avoid a second signIn that adds
  // extra sessions and can interfere with other devices.
  for (let attempt = 0; attempt < 8; attempt++) {
    const { data } = await getSession(supabase);
    if (data.session?.user) {
      return { ok: true };
    }
    await new Promise((resolve) => setTimeout(resolve, 80));
  }

  const email = await resolveEmailForUsername(supabase, username.trim());
  if (!email) {
    return { ok: false, error: "تعذر تحديد حساب الدخول" };
  }

  const { error } = await signInWithPassword(supabase, email, password);
  if (error) {
    return { ok: false, error: error.message || "تعذر حفظ الجلسة" };
  }

  for (let attempt = 0; attempt < 8; attempt++) {
    const { data } = await getSession(supabase);
    if (data.session?.user) {
      return { ok: true };
    }
    await new Promise((resolve) => setTimeout(resolve, 80));
  }

  return {
    ok: false,
    error:
      "تم التحقق من الحساب لكن الجلسة لم تُحفظ على الجهاز — أغلق التطبيق وافتحه من جديد ثم حاول مرة أخرى",
  };
}

export function authPortalFromLoginPortal(portalId: string): AuthPortalId | null {
  return loginPortalToAuthPortalId(portalId);
}
