import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

/**
 * POST /api/admin/create-user
 * Creates a new Supabase Auth user + profile row.
 * Requires: accountant or super_admin role.
 * Body: { username, password, full_name, role, clinic_id? }
 */
export async function POST(req: NextRequest) {
  try {
    // ── 1. Verify caller is accountant or super_admin ──
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
      return NextResponse.json({ error: "غير مصرح" }, { status: 401 });
    }

    const { data: callerProfile } = await supabase
      .from("profiles")
      .select("role, clinic_id")
      .eq("id", user.id)
      .single();

    if (!callerProfile || !["accountant", "super_admin"].includes(callerProfile.role)) {
      return NextResponse.json({ error: "صلاحية غير كافية" }, { status: 403 });
    }

    // ── 2. Parse body ──
    const body = await req.json();
    const { username, password, full_name, role, phone } = body as {
      username: string;
      password: string;
      full_name: string;
      role: "accountant" | "doctor";
      phone?: string;
    };

    if (!username || !password || !full_name || !role) {
      return NextResponse.json({ error: "جميع الحقول مطلوبة" }, { status: 400 });
    }
    if (!["accountant", "doctor"].includes(role)) {
      return NextResponse.json({ error: "دور غير صالح" }, { status: 400 });
    }
    if (password.length < 6) {
      return NextResponse.json({ error: "كلمة المرور يجب أن تكون 6 أحرف على الأقل" }, { status: 400 });
    }

    // clinic_id: super_admin can specify, accountant uses their own clinic
    const clinic_id = callerProfile.clinic_id;
    if (!clinic_id) {
      return NextResponse.json({ error: "لا توجد عيادة مرتبطة بحسابك" }, { status: 400 });
    }

    // ── 3. Check username not taken ──
    const { data: existing } = await supabase
      .from("profiles")
      .select("id")
      .eq("username", username)
      .maybeSingle();

    if (existing) {
      return NextResponse.json({ error: "اسم المستخدم محجوز — اختر اسماً آخر" }, { status: 409 });
    }

    // ── 4. Use service role to create the auth user ──
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!serviceKey) {
      return NextResponse.json(
        { error: "مفتاح الخدمة غير مضبوط — أضف SUPABASE_SERVICE_ROLE_KEY في .env.local" },
        { status: 500 }
      );
    }

    const admin = createServiceClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      serviceKey,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    // Create a fake email from username (Supabase Auth requires email)
    const fakeEmail = `${username}@clinic.internal`;

    const { data: authData, error: authError } = await admin.auth.admin.createUser({
      email: fakeEmail,
      password,
      email_confirm: true,
      user_metadata: { full_name, username },
    });

    if (authError || !authData.user) {
      return NextResponse.json(
        { error: authError?.message ?? "تعذر إنشاء الحساب" },
        { status: 500 }
      );
    }

    // ── 5. Insert profile row ──
    const { error: profileError } = await admin
      .from("profiles")
      .insert({
        id:        authData.user.id,
        clinic_id,
        role,
        full_name,
        username,
        phone: phone ?? null,
        is_active: true,
      });

    if (profileError) {
      // Rollback — delete the auth user we just created
      await admin.auth.admin.deleteUser(authData.user.id);
      return NextResponse.json(
        { error: `تعذر حفظ الملف الشخصي: ${profileError.message}` },
        { status: 500 }
      );
    }

    // ── 6. If role is doctor, create a doctor record too ──
    if (role === "doctor") {
      await admin.from("doctors").insert({
        clinic_id,
        profile_id:    authData.user.id,
        full_name_ar:  full_name,
        percentage:    "50",
        materials_share: "0",
        is_active:     true,
      });
    }

    return NextResponse.json({
      success: true,
      message: `تم إنشاء حساب ${full_name} بنجاح`,
      user_id: authData.user.id,
    });

  } catch (err) {
    console.error("[create-user]", err);
    return NextResponse.json({ error: "خطأ داخلي في الخادم" }, { status: 500 });
  }
}
