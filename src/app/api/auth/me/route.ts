import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * GET /api/auth/me
 * Development diagnostic — returns the current user's auth + profile data.
 * Use to verify the session and DB role are correct.
 */
export async function GET() {
  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: () => {},
      },
    }
  );

  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ authenticated: false, user: null, profile: null });
  }

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("id, role, full_name, username, clinic_id, is_active")
    .eq("id", user.id)
    .maybeSingle();

  return NextResponse.json({
    authenticated: true,
    user: {
      id:    user.id,
      email: user.email,
    },
    profile: profile ?? null,
    profileError: error?.message ?? null,
    expectedDashboard:
      profile?.role === "super_admin" ? "/admin"     :
      profile?.role === "doctor"      ? "/doctor"    :
      profile?.role === "accountant"  ? "/dashboard" :
      "unknown — profile missing or role null",
  });
}
