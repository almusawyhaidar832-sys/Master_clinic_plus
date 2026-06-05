import { NextRequest, NextResponse } from "next/server";
import { usernameToAuthEmail } from "@/lib/auth/credentials";
import { requireStaffAdmin } from "@/lib/admin/require-staff-admin";
import { createApiSessionClient } from "@/lib/auth/api-session";
import { validatePatientPhone } from "@/lib/phone";
import {
  insertProfileRow,
  isUsernameTaken,
  readProfileUsername,
  updateProfileRow,
} from "@/lib/admin/profile-write";
import { getAuthAdmin } from "@/lib/supabase/auth-helpers";
import type { Doctor } from "@/types";

function sanitizeUsername(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/\s/g, "")
    .replace(/[^a-z0-9._-]/g, "");
}

async function loadDoctorForCaller(
  ctx: Awaited<ReturnType<typeof requireStaffAdmin>>,
  doctorId: string
) {
  if ("error" in ctx) return { error: ctx.error, status: ctx.status };

  const sessionClient = await createApiSessionClient();
  const { data: doctorRow, error } = await sessionClient
    .from("doctors")
    .select("*")
    .eq("id", doctorId)
    .maybeSingle();

  if (error) {
    return { error: error.message, status: 500 };
  }
  if (!doctorRow) {
    return {
      error: "الطبيب غير موجود أو لا تملك صلاحية الوصول إليه",
      status: 404,
    };
  }

  const doctor = doctorRow as Doctor;

  let username: string | null = null;
  let hasLogin = false;
  if (doctor.profile_id) {
    username = await readProfileUsername(ctx.admin, doctor.profile_id);
    hasLogin = true;
  }

  return {
    doctor,
    username,
    hasLogin,
  };
}

/** GET — بيانات الطبيب للتعديل */
export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireStaffAdmin();
    const { id } = await context.params;
    const loaded = await loadDoctorForCaller(ctx, id);
    if ("error" in loaded) {
      return NextResponse.json(
        { error: loaded.error },
        { status: loaded.status }
      );
    }

    return NextResponse.json({
      doctor: loaded.doctor,
      username: loaded.username,
      hasLogin: loaded.hasLogin,
    });
  } catch (err) {
    console.error("[admin/doctors/GET]", err);
    return NextResponse.json({ error: "خطأ داخلي" }, { status: 500 });
  }
}

/** PATCH — تعديل بيانات الطبيب + هاتف واتساب + حساب الدخول */
export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireStaffAdmin();
    if ("error" in ctx) {
      return NextResponse.json({ error: ctx.error }, { status: ctx.status });
    }

    const { id } = await context.params;
    const loaded = await loadDoctorForCaller(ctx, id);
    if ("error" in loaded) {
      return NextResponse.json(
        { error: loaded.error },
        { status: loaded.status }
      );
    }

    const doctor = loaded.doctor;
    const body = await req.json();
    const fullName = body.full_name_ar?.trim();
    const specialty = body.specialty_ar?.trim() ?? null;
    const phoneRaw = body.phone?.trim() ?? "";
    const percentage = body.percentage;
    const materialsShare = body.materials_share;
    const usernameRaw = body.username?.trim() ?? "";
    const password = String(body.password ?? "");

    const doctorUpdate: Record<string, unknown> = {};
    if (fullName) doctorUpdate.full_name_ar = fullName;
    if (body.specialty_ar !== undefined) doctorUpdate.specialty_ar = specialty;
    if (percentage) doctorUpdate.percentage = String(percentage);
    if (materialsShare) doctorUpdate.materials_share = String(materialsShare);

    let normalizedPhone: string | null = null;
    if (body.phone !== undefined) {
      if (!phoneRaw) {
        doctorUpdate.phone = null;
        normalizedPhone = null;
      } else {
        const phoneCheck = validatePatientPhone(phoneRaw);
        if (!phoneCheck.ok) {
          return NextResponse.json({ error: phoneCheck.message }, { status: 400 });
        }
        normalizedPhone = phoneCheck.normalized;
        doctorUpdate.phone = phoneRaw;
      }
    }

    const safeUsername = usernameRaw ? sanitizeUsername(usernameRaw) : "";
    if (usernameRaw && safeUsername.length < 3) {
      return NextResponse.json(
        { error: "اسم المستخدم: 3 أحرف إنجليزية على الأقل" },
        { status: 400 }
      );
    }
    if (password && password.length < 6) {
      return NextResponse.json(
        { error: "كلمة المرور 6 أحرف على الأقل" },
        { status: 400 }
      );
    }

    let profileId: string | null = doctor.profile_id?.trim() || null;

    // إنشاء حساب دخول لطبيب بدون profile_id
    if (!profileId && safeUsername && password) {
      const authEmail = usernameToAuthEmail(safeUsername);

      if (await isUsernameTaken(ctx.admin, safeUsername)) {
        return NextResponse.json(
          { error: "اسم المستخدم محجوز — اختر اسماً آخر" },
          { status: 409 }
        );
      }

      const { data: authData, error: authError } =
        await getAuthAdmin(ctx.admin).createUser({
          email: authEmail,
          password,
          email_confirm: true,
          user_metadata: {
            full_name: fullName || doctor.full_name_ar,
            username: safeUsername,
          },
        });

      if (authError || !authData.user) {
        const msg = authError?.message ?? "تعذر إنشاء الحساب";
        if (msg.toLowerCase().includes("already")) {
          return NextResponse.json(
            { error: "اسم المستخدم محجوز — اختر اسماً آخر" },
            { status: 409 }
          );
        }
        return NextResponse.json({ error: msg }, { status: 500 });
      }

      profileId = authData.user.id;

      const profilePayload: Record<string, unknown> = {
        id: profileId,
        clinic_id: doctor.clinic_id,
        role: "doctor",
        full_name: fullName || doctor.full_name_ar,
        phone: normalizedPhone ?? doctor.phone ?? null,
        is_active: doctor.is_active !== false,
        username: safeUsername,
      };

      const inserted = await insertProfileRow(ctx.admin, profilePayload);
      if (inserted.error) {
        await getAuthAdmin(ctx.admin).deleteUser(profileId);
        return NextResponse.json(
          { error: `تعذر حفظ الملف الشخصي: ${inserted.error}` },
          { status: 500 }
        );
      }

      doctorUpdate.profile_id = profileId;
    }

    // تحديث حساب موجود
    if (profileId) {
      const profileUpdate: Record<string, unknown> = {};
      if (fullName) profileUpdate.full_name = fullName;
      if (body.phone !== undefined) {
        profileUpdate.phone = normalizedPhone ?? (phoneRaw || null);
      }
      if (doctor.is_active !== undefined) {
        profileUpdate.is_active = doctor.is_active;
      }

      if (safeUsername && safeUsername !== loaded.username) {
        if (await isUsernameTaken(ctx.admin, safeUsername, profileId)) {
          return NextResponse.json(
            { error: "اسم المستخدم محجوز — اختر اسماً آخر" },
            { status: 409 }
          );
        }

        const newEmail = usernameToAuthEmail(safeUsername);
        const { error: authUpdateErr } = await getAuthAdmin(
          ctx.admin
        ).updateUserById(profileId, {
          email: newEmail,
          user_metadata: { username: safeUsername },
        });
        if (authUpdateErr) {
          return NextResponse.json(
            { error: authUpdateErr.message ?? "تعذر تحديث اسم المستخدم" },
            { status: 500 }
          );
        }
        profileUpdate.username = safeUsername;
      }

      if (password) {
        const { error: passErr } = await getAuthAdmin(ctx.admin).updateUserById(
          profileId,
          { password }
        );
        if (passErr) {
          return NextResponse.json(
            { error: passErr.message ?? "تعذر تحديث كلمة المرور" },
            { status: 500 }
          );
        }
      }

      if (Object.keys(profileUpdate).length > 0) {
        const updated = await updateProfileRow(
          ctx.admin,
          profileId,
          profileUpdate
        );
        if (updated.error) {
          return NextResponse.json(
            { error: `تعذر تحديث الملف الشخصي: ${updated.error}` },
            { status: 500 }
          );
        }
      }
    } else if ((safeUsername || password) && !profileId) {
      return NextResponse.json(
        {
          error:
            "لإضافة حساب دخول أدخل اسم المستخدم وكلمة المرور معاً",
        },
        { status: 400 }
      );
    }

    if (Object.keys(doctorUpdate).length > 0) {
      const { error: doctorErr } = await ctx.admin
        .from("doctors")
        .update(doctorUpdate)
        .eq("id", id);
      if (doctorErr) {
        return NextResponse.json(
          { error: `تعذر تحديث بيانات الطبيب: ${doctorErr.message}` },
          { status: 500 }
        );
      }
    }

    return NextResponse.json({
      success: true,
      message: "تم حفظ بيانات الطبيب",
      hasLogin: Boolean(profileId),
      username: safeUsername || loaded.username,
    });
  } catch (err) {
    console.error("[admin/doctors/PATCH]", err);
    return NextResponse.json({ error: "خطأ داخلي" }, { status: 500 });
  }
}

/** DELETE — إيقاف الطبيب (حذف من القائمة النشطة) */
export async function DELETE(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireStaffAdmin();
    if ("error" in ctx) {
      return NextResponse.json({ error: ctx.error }, { status: ctx.status });
    }

    const { id } = await context.params;
    const loaded = await loadDoctorForCaller(ctx, id);
    if ("error" in loaded) {
      return NextResponse.json(
        { error: loaded.error },
        { status: loaded.status }
      );
    }

    const doctor = loaded.doctor;
    const { error: doctorErr } = await ctx.admin
      .from("doctors")
      .update({ is_active: false })
      .eq("id", id);

    if (doctorErr) {
      return NextResponse.json(
        { error: `تعذر إيقاف الطبيب: ${doctorErr.message}` },
        { status: 500 }
      );
    }

    if (doctor.profile_id) {
      await ctx.admin
        .from("profiles")
        .update({ is_active: false })
        .eq("id", doctor.profile_id);
    }

    return NextResponse.json({
      success: true,
      message: `تم إيقاف الطبيب «${doctor.full_name_ar}»`,
    });
  } catch (err) {
    console.error("[admin/doctors/DELETE]", err);
    return NextResponse.json({ error: "خطأ داخلي" }, { status: 500 });
  }
}
