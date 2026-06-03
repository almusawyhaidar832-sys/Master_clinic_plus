import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { usernameToAuthEmail } from "@/lib/auth/credentials";
import { getCurrentUser, getAuthAdmin } from "@/lib/supabase/auth-helpers";

/**
 * POST /api/admin/create-user
 *
 * Uses service_role for EVERYTHING after session verification, so RLS
 * never blocks the operation. Session JWT is verified via anon client,
 * all DB work uses service_role.
 *
 * Body: { full_name, password, role, phone?, username?, clinic_id?,
 *         specialty_ar?, percentage?, materials_share? }
 *   role: "accountant" | "doctor"
 */
export async function POST(req: NextRequest) {
  try {
    // ── Step 1: verify session (JWT check only) ───────────────────────────
    const cookieStore = await cookies();
    const sessionClient = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll: () => cookieStore.getAll(),
          setAll: () => {},
        },
      }
    );

    const user = await getCurrentUser(sessionClient);
    if (!user) {
      return NextResponse.json({ error: "يجب تسجيل الدخول أولاً" }, { status: 401 });
    }

    // ── Step 2: build service-role admin client ───────────────────────────
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!serviceKey) {
      return NextResponse.json(
        { error: "SUPABASE_SERVICE_ROLE_KEY غير مضبوط في .env.local" },
        { status: 500 }
      );
    }

    const admin = createServiceClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      serviceKey,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    // ── Step 3: read caller's profile via service_role (bypasses RLS) ─────
    const { data: callerProfile, error: callerErr } = await admin
      .from("profiles")
      .select("role, clinic_id")
      .eq("id", user.id)
      .maybeSingle();

    if (callerErr) {
      console.error("[create-user] profile read error:", callerErr.message);
      return NextResponse.json(
        { error: `تعذر قراءة بيانات حسابك: ${callerErr.message}` },
        { status: 500 }
      );
    }

    if (!callerProfile) {
      return NextResponse.json(
        { error: "لا يوجد ملف شخصي لحسابك — تأكد من إعداد قاعدة البيانات" },
        { status: 403 }
      );
    }

    if (!["accountant", "super_admin"].includes(callerProfile.role)) {
      return NextResponse.json(
        { error: `دورك الحالي (${callerProfile.role}) لا يملك صلاحية إنشاء حسابات` },
        { status: 403 }
      );
    }

    // ── Step 4: parse & validate body ─────────────────────────────────────
    const body = await req.json();
    const {
      full_name,
      password,
      role,
      phone       = null,
      username    = null,
      clinic_id: bodyClinicId = null,
      specialty_ar = null,
      percentage   = "50",
      materials_share = "0",
    } = body as {
      full_name:  string;
      password:   string;
      role:       "accountant" | "doctor";
      phone?:     string | null;
      username?:  string | null;
      clinic_id?: string | null;
      specialty_ar?: string | null;
      percentage?: string;
      materials_share?: string;
    };

    if (!full_name?.trim() || !password || !role) {
      return NextResponse.json({ error: "الاسم وكلمة المرور والدور مطلوبة" }, { status: 400 });
    }
    if (!["accountant", "doctor"].includes(role)) {
      return NextResponse.json({ error: "الدور يجب أن يكون accountant أو doctor" }, { status: 400 });
    }
    if (password.length < 6) {
      return NextResponse.json({ error: "كلمة المرور 6 أحرف على الأقل" }, { status: 400 });
    }

    // username is required — login resolves username → email
    const safeUsername = (username?.trim() || "")
      .toLowerCase()
      .replace(/\s/g, "")
      .replace(/[^a-z0-9._-]/g, "");

    if (safeUsername.length < 3) {
      return NextResponse.json(
        { error: "اسم المستخدم مطلوب (3 أحرف إنجليزية على الأقل، مثل mohamed123)" },
        { status: 400 }
      );
    }

    // ── Step 5: permission rules ───────────────────────────────────────────
    if (callerProfile.role === "super_admin" && role !== "accountant") {
      return NextResponse.json({ error: "المدير يمكنه إضافة محاسبين فقط" }, { status: 403 });
    }
    if (callerProfile.role === "accountant" && role !== "doctor") {
      return NextResponse.json({ error: "المحاسب يمكنه إضافة أطباء فقط" }, { status: 403 });
    }

    // ── Step 6: resolve clinic_id ──────────────────────────────────────────
    let clinic_id: string | null = callerProfile.clinic_id ?? bodyClinicId;

    // super_admin with no clinic_id: fall back to first clinic in DB
    if (!clinic_id) {
      const { data: firstClinic } = await admin
        .from("clinics")
        .select("id")
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      clinic_id = firstClinic?.id ?? null;
    }

    if (!clinic_id) {
      return NextResponse.json(
        { error: "لا توجد عيادة في النظام — أنشئ عيادة أولاً" },
        { status: 400 }
      );
    }

    // ── Step 7: build auth email (must match login resolver) ───────────────
    const authEmail = usernameToAuthEmail(safeUsername);

    // ── Step 8: create auth user ───────────────────────────────────────────
    const { data: authData, error: authError } = await getAuthAdmin(admin).createUser({
      email:         authEmail,
      password,
      email_confirm: true,
      user_metadata: { full_name: full_name.trim(), username: safeUsername },
    });

    if (authError) {
      if (authError.message?.toLowerCase().includes("already") ||
          authError.message?.toLowerCase().includes("registered")) {
        return NextResponse.json(
          { error: "اسم المستخدم محجوز — اختر اسماً آخر" },
          { status: 409 }
        );
      }
      return NextResponse.json(
        { error: authError.message ?? "تعذر إنشاء الحساب في Auth" },
        { status: 500 }
      );
    }

    if (!authData.user) {
      return NextResponse.json(
        { error: "تعذر إنشاء الحساب في Auth" },
        { status: 500 }
      );
    }

    // ── Step 9: insert profile ─────────────────────────────────────────────
    // Build profile object — include username only if column exists
    const profilePayload: Record<string, unknown> = {
      id:        authData.user.id,
      clinic_id,
      role,
      full_name: full_name.trim(),
      phone:     phone ?? null,
      is_active: true,
    };

    // Try with username first; retry without if column doesn't exist
    const { error: profileErr } = await admin
      .from("profiles")
      .insert({ ...profilePayload, username: safeUsername });

    if (profileErr) {
      if (profileErr.message.includes("username")) {
        // Column might not exist — insert without username
        const { error: profileErr2 } = await admin
          .from("profiles")
          .insert(profilePayload);

        if (profileErr2) {
          await getAuthAdmin(admin).deleteUser(authData.user.id);
          return NextResponse.json(
            { error: `تعذر حفظ الملف الشخصي: ${profileErr2.message}` },
            { status: 500 }
          );
        }
      } else {
        await getAuthAdmin(admin).deleteUser(authData.user.id);
        return NextResponse.json(
          { error: `تعذر حفظ الملف الشخصي: ${profileErr.message}` },
          { status: 500 }
        );
      }
    }

    // ── Step 10: create doctors record if needed ───────────────────────────
    if (role === "doctor") {
      const validPercentages = ["10","20","30","40","50","60","70","80"];
      const validMaterials   = ["0","10","20","30","40","50"];
      const docPercentage    = validPercentages.includes(String(percentage))
        ? String(percentage) : "50";
      const docMaterials     = validMaterials.includes(String(materials_share))
        ? String(materials_share) : "0";

      const { error: doctorErr } = await admin.from("doctors").insert({
        clinic_id,
        profile_id:      authData.user.id,
        full_name_ar:    full_name.trim(),
        specialty_ar:    specialty_ar?.trim() || null,
        phone:           phone ?? null,
        percentage:      docPercentage,
        materials_share: docMaterials,
        is_active:       true,
      });

      if (doctorErr) {
        await getAuthAdmin(admin).deleteUser(authData.user.id);
        await admin.from("profiles").delete().eq("id", authData.user.id);
        return NextResponse.json(
          { error: `تعذر حفظ بيانات الطبيب: ${doctorErr.message}` },
          { status: 500 }
        );
      }
    }

    return NextResponse.json({
      success:  true,
      message:  `✓ تم إنشاء حساب "${full_name.trim()}" — الدخول بـ: ${safeUsername}`,
      user_id:  authData.user.id,
      username: safeUsername,
    });

  } catch (err) {
    console.error("[create-user] unexpected error:", err);
    return NextResponse.json({ error: "خطأ داخلي في الخادم" }, { status: 500 });
  }
}
