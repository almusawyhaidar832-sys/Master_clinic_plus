import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { canRoleChangeOwnPassword, normalizeRole } from "@/lib/auth/portal-access";
import { getCurrentUser } from "@/lib/supabase/auth-helpers";
import { createServerAuthClientFromAnySession } from "@/lib/supabase/create-auth-client";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const cookieStore = await cookies();
    const supabase = await createServerAuthClientFromAnySession({
      getAll: () => cookieStore.getAll(),
      setAll: () => {},
    });

    const user = await getCurrentUser(supabase);
    if (!user) {
      return NextResponse.json({ error: "غير مسجل الدخول" }, { status: 401 });
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .maybeSingle();

    const role = normalizeRole(profile?.role as string | undefined);
    if (!canRoleChangeOwnPassword(role)) {
      return NextResponse.json(
        { error: "المحاسب لا يملك صلاحية تغيير كلمة المرور" },
        { status: 403 }
      );
    }

    const body = await request.json();
    const newPassword = String(body.newPassword ?? "");
    const confirmPassword = String(body.confirmPassword ?? "");

    if (!newPassword || newPassword.length < 8) {
      return NextResponse.json(
        { error: "كلمة المرور الجديدة 8 أحرف على الأقل" },
        { status: 400 }
      );
    }

    if (newPassword !== confirmPassword) {
      return NextResponse.json(
        { error: "تأكيد كلمة المرور غير متطابق" },
        { status: 400 }
      );
    }

    const { error } = await supabase.auth.updateUser({ password: newPassword });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ ok: true, message: "تم تحديث كلمة المرور" });
  } catch (e) {
    console.error("[api/auth/change-password]", e);
    return NextResponse.json({ error: "خطأ داخلي" }, { status: 500 });
  }
}
