import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  resolveEmailForUsername,
} from "@/lib/auth/credentials";

/** Server-side login (optional). Prefer client signIn in login page for cookie sync. */
export async function POST(request: Request) {
  const body = await request.json();
  const username = String(body.username ?? "").trim();
  const password = String(body.password ?? "");

  if (!username || !password) {
    return NextResponse.json(
      { error: "اسم المستخدم وكلمة المرور مطلوبان" },
      { status: 400 }
    );
  }

  const supabase = await createClient();
  const email = await resolveEmailForUsername(supabase, username);

  if (!email) {
    return NextResponse.json(
      { error: "اسم المستخدم غير موجود" },
      { status: 401 }
    );
  }

  const { data: authData, error: authError } =
    await supabase.auth.signInWithPassword({ email, password });

  if (authError || !authData.user) {
    return NextResponse.json(
      { error: "اسم المستخدم أو كلمة المرور غير صحيحة" },
      { status: 401 }
    );
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", authData.user.id)
    .single();

  return NextResponse.json({
    ok: true,
    role: profile?.role ?? "accountant",
  });
}
