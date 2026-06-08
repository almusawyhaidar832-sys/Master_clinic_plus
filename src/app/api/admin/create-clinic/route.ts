import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import {
  isValidSanitizedUsername,
  sanitizeUsername,
  usernameToAuthEmail,
} from "@/lib/auth/credentials";
import { getCurrentUser, getAuthAdmin } from "@/lib/supabase/auth-helpers";

/**
 * POST /api/admin/create-clinic
 * ينشئ عيادة جديدة + حساب مدير (accountant) في خطوة واحدة
 * مخصص لـ super_admin فقط
 */
export async function POST(req: NextRequest) {
  try {
    // ── تحقق أن المستخدم super_admin ──
    const cookieStore = await cookies();
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { cookies: { getAll: () => cookieStore.getAll(), setAll: () => {} } }
    );

    const user = await getCurrentUser(supabase);
    if (!user) return NextResponse.json({ error: "غير مصرح" }, { status: 401 });

    const { data: caller } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();

    if (caller?.role !== "super_admin") {
      return NextResponse.json({ error: "للمالك فقط" }, { status: 403 });
    }

    // ── قراءة البيانات ──
    const {
      clinic_name, clinic_name_ar, clinic_phone,
      admin_full_name, admin_username, admin_password,
      specialty,
    } = await req.json();

    if (!clinic_name || !admin_username || !admin_password || !admin_full_name) {
      return NextResponse.json({ error: "جميع الحقول مطلوبة" }, { status: 400 });
    }
    if (admin_password.length < 6) {
      return NextResponse.json({ error: "كلمة المرور 6 أحرف على الأقل" }, { status: 400 });
    }

    const safeUsername = sanitizeUsername(admin_username);
    if (!isValidSanitizedUsername(safeUsername)) {
      return NextResponse.json(
        {
          error:
            "اسم مستخدم المدير: 3–32 حرفاً إنجليزياً (a-z، أرقام، . _ -) — مثل owner1",
        },
        { status: 400 }
      );
    }

    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!serviceKey) {
      return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY غير مضبوط" }, { status: 500 });
    }

    const admin = createServiceClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      serviceKey,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    // ── تحقق أن username غير محجوز ──
    const { data: existing } = await admin
      .from("profiles")
      .select("id")
      .eq("username", safeUsername)
      .maybeSingle();

    if (existing) {
      return NextResponse.json({ error: "اسم المستخدم محجوز" }, { status: 409 });
    }

    // ── 1. إنشاء العيادة ──
    const { data: clinic, error: clinicErr } = await admin
      .from("clinics")
      .insert({
        name:    clinic_name,
        name_ar: clinic_name_ar || clinic_name,
        phone:   clinic_phone || null,
      })
      .select()
      .single();

    if (clinicErr || !clinic) {
      return NextResponse.json({ error: `فشل إنشاء العيادة: ${clinicErr?.message}` }, { status: 500 });
    }

    // ── 2. Seed إعدادات الوحدات ──
    await admin.rpc("seed_clinic_settings", {
      p_clinic_id: clinic.id,
      p_specialty: specialty || "dental",
    });

    // ── 3. إنشاء حساب Auth ──
    const authEmail = usernameToAuthEmail(safeUsername);
    const { data: authData, error: authErr } = await getAuthAdmin(admin).createUser({
      email: authEmail,
      password: admin_password,
      email_confirm: true,
      user_metadata: { full_name: admin_full_name, username: safeUsername },
    });

    if (authErr || !authData.user) {
      // rollback clinic
      await admin.from("clinics").delete().eq("id", clinic.id);
      return NextResponse.json({ error: authErr?.message ?? "فشل إنشاء الحساب" }, { status: 500 });
    }

    // ── 4. إنشاء profile ──
    const { error: profileErr } = await admin.from("profiles").insert({
      id:        authData.user.id,
      clinic_id: clinic.id,
      role:      "super_admin",
      full_name: admin_full_name,
      username:  safeUsername,
      is_active: true,
    });

    if (profileErr) {
      await getAuthAdmin(admin).deleteUser(authData.user.id);
      await admin.from("clinics").delete().eq("id", clinic.id);
      return NextResponse.json({ error: `فشل الملف الشخصي: ${profileErr.message}` }, { status: 500 });
    }

    return NextResponse.json({
      success:    true,
      clinic_id:  clinic.id,
      clinic_name: clinic_name_ar || clinic_name,
      message:    `✓ تم إنشاء عيادة "${clinic_name_ar || clinic_name}" مع حساب المدير "${safeUsername}" بنجاح`,
    });

  } catch (e) {
    console.error("[create-clinic]", e);
    return NextResponse.json({ error: "خطأ داخلي" }, { status: 500 });
  }
}
