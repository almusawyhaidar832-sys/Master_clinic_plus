import { NextRequest, NextResponse } from "next/server";
import { getApiCallerProfile } from "@/lib/auth/api-session";
import { getAdminClient } from "@/lib/supabase/admin";
import type { PayrollEmployeeCategory } from "@/lib/services/payroll-persons";

/**
 * POST /api/payroll/deactivate-employee
 * إيقاف/أرشفة موظف — يختفي من قائمة الرواتب (لا حذف من التاريخ)
 */
export async function POST(req: NextRequest) {
  try {
    const caller = await getApiCallerProfile(req);
    if (!caller) {
      return NextResponse.json({ error: "يجب تسجيل الدخول أولاً" }, { status: 401 });
    }

    if (!["accountant", "super_admin"].includes(caller.role)) {
      return NextResponse.json({ error: "صلاحيات غير كافية" }, { status: 403 });
    }

    const clinicId = caller.clinic_id;
    if (!clinicId) {
      return NextResponse.json({ error: "حسابك غير مربوط بعيادة" }, { status: 400 });
    }

    const body = await req.json();
    const { category, id } = body as {
      category: PayrollEmployeeCategory;
      id: string;
    };

    if (!category || !id) {
      return NextResponse.json({ error: "النوع والمعرّف مطلوبان" }, { status: 400 });
    }

    const admin = getAdminClient();

    if (category === "assistant") {
      const { data: row } = await admin
        .from("assistants")
        .select("id, profile_id, full_name_ar")
        .eq("id", id)
        .eq("clinic_id", clinicId)
        .maybeSingle();

      if (!row) {
        return NextResponse.json({ error: "المساعد غير موجود" }, { status: 404 });
      }

      if (row.profile_id) {
        await admin
          .from("profiles")
          .update({ is_active: false })
          .eq("id", row.profile_id);
      }

      const { error } = await admin
        .from("assistants")
        .update({ is_active: false })
        .eq("id", id);

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }

      return NextResponse.json({
        success: true,
        name: row.full_name_ar,
        message: `تم إيقاف ${row.full_name_ar} — لن يظهر في الرواتب`,
      });
    }

    if (category === "doctor_salary") {
      const { data: row } = await admin
        .from("doctors")
        .select("id, profile_id, full_name_ar")
        .eq("id", id)
        .eq("clinic_id", clinicId)
        .maybeSingle();

      if (!row) {
        return NextResponse.json({ error: "الطبيب غير موجود" }, { status: 404 });
      }

      if (row.profile_id) {
        await admin
          .from("profiles")
          .update({ is_active: false })
          .eq("id", row.profile_id);
      }

      const { error } = await admin
        .from("doctors")
        .update({ is_active: false })
        .eq("id", id);

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }

      return NextResponse.json({
        success: true,
        name: row.full_name_ar,
        message: `تم إيقاف ${row.full_name_ar} — لن يظهر في الرواتب`,
      });
    }

    if (category === "general" || category === "accountant") {
      const { data: staff } = await admin
        .from("staff_members")
        .select("id, profile_id, full_name_ar")
        .eq("id", id)
        .eq("clinic_id", clinicId)
        .maybeSingle();

      if (!staff) {
        return NextResponse.json({ error: "الموظف غير موجود" }, { status: 404 });
      }

      if (staff.profile_id) {
        await admin
          .from("profiles")
          .update({ is_active: false })
          .eq("id", staff.profile_id)
          .eq("clinic_id", clinicId);
      }

      const { error } = await admin
        .from("staff_members")
        .update({ is_active: false })
        .eq("id", id);

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }

      return NextResponse.json({
        success: true,
        name: staff.full_name_ar,
        message: `تم إيقاف ${staff.full_name_ar} — لن يظهر في الرواتب`,
      });
    }

    return NextResponse.json({ error: "نوع غير صالح" }, { status: 400 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "خطأ غير متوقع";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
