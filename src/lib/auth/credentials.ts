import type { SupabaseClient } from "@supabase/supabase-js";

function authClient(supabase: SupabaseClient) {
  return supabase.auth as {
    signInWithPassword: (opts: {
      email: string;
      password: string;
    }) => Promise<{
      data: { user: { id: string } | null };
      error: { message: string } | null;
    }>;
    signUp: (opts: {
      email: string;
      password: string;
      options?: { data?: Record<string, string> };
    }) => Promise<{
      data: { user: { id: string } | null; session: unknown | null };
      error: { message: string } | null;
    }>;
  };
}

/** Internal auth email for username-only accounts */
export function usernameToAuthEmail(username: string): string {
  const safe = username
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, "");
  return `${safe}@masterclinic.local`;
}

/**
 * Resolve Supabase Auth email from username field.
 * Supports: real email, profiles.username → auth.users, or @masterclinic.local pattern.
 */
export async function resolveEmailForUsername(
  supabase: SupabaseClient,
  username: string
): Promise<string | null> {
  const trimmed = username.trim();
  if (!trimmed) return null;

  if (trimmed.includes("@")) {
    return trimmed;
  }

  const { data: rpcEmail, error: rpcError } = await supabase.rpc(
    "get_email_for_username",
    { p_username: trimmed }
  );

  if (!rpcError && rpcEmail && typeof rpcEmail === "string") {
    return rpcEmail;
  }

  return usernameToAuthEmail(trimmed);
}

export async function signInWithUsername(
  supabase: SupabaseClient,
  username: string,
  password: string
): Promise<{ ok: true; role: string } | { ok: false; error: string }> {
  const email = await resolveEmailForUsername(supabase, username);

  if (!email) {
    return { ok: false, error: "أدخل اسم المستخدم" };
  }

  const { data, error } = await authClient(supabase).signInWithPassword({
    email,
    password,
  });

  if (error || !data.user) {
    const msg = error?.message ?? "";
    if (msg.includes("Invalid login credentials")) {
      return {
        ok: false,
        error:
          "اسم المستخدم أو كلمة المرور غير صحيحة. إذا كان حسابك قديماً، جرّب إدخال بريدك في حقل اسم المستخدم.",
      };
    }
    return { ok: false, error: msg || "تعذر تسجيل الدخول" };
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", data.user.id)
    .maybeSingle();

  if (profileError) {
    return { ok: false, error: "تم الدخول لكن تعذر تحميل الملف الشخصي" };
  }

  return {
    ok: true,
    role: profile?.role ?? "accountant",
  };
}

export async function registerWithUsername(
  supabase: SupabaseClient,
  username: string,
  password: string,
  fullName: string
): Promise<{ ok: true; message: string } | { ok: false; error: string }> {
  const trimmed = username.trim();

  if (trimmed.length < 3) {
    return { ok: false, error: "اسم المستخدم يجب أن يكون 3 أحرف على الأقل" };
  }

  if (password.length < 6) {
    return { ok: false, error: "كلمة المرور يجب أن تكون 6 أحرف على الأقل" };
  }

  const email = usernameToAuthEmail(trimmed);

  const { data: taken, error: takenError } = await supabase.rpc(
    "get_email_for_username",
    { p_username: trimmed }
  );

  if (!takenError && taken) {
    return { ok: false, error: "اسم المستخدم مستخدم مسبقاً" };
  }

  const { data: clinic } = await supabase
    .from("clinics")
    .select("id")
    .limit(1)
    .maybeSingle();

  if (!clinic?.id) {
    return {
      ok: false,
      error: "لا توجد عيادة مسجّلة. يجب إعداد العيادة في Supabase أولاً.",
    };
  }

  const { data: signUpData, error: signUpError } = await authClient(supabase).signUp({
    email,
    password,
    options: {
      data: { username: trimmed, full_name: fullName },
    },
  });

  if (signUpError) {
    return { ok: false, error: signUpError.message };
  }

  if (!signUpData.user) {
    return { ok: false, error: "تعذر إنشاء الحساب" };
  }

  const { error: profileError } = await supabase.from("profiles").upsert({
    id: signUpData.user.id,
    username: trimmed,
    full_name: fullName,
    role: "accountant",
    clinic_id: clinic.id,
  });

  if (profileError) {
    return {
      ok: false,
      error: `تم إنشاء الحساب لكن فشل حفظ الملف: ${profileError.message}`,
    };
  }

  if (signUpData.session) {
    return { ok: true, message: "تم إنشاء الحساب وتسجيل الدخول بنجاح" };
  }

  return {
    ok: true,
    message:
      "تم إنشاء الحساب. إذا لم يتم الدخول تلقائياً، عطّل تأكيد البريد في Supabase ثم سجّل الدخول.",
  };
}
