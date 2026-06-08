import { NextRequest, NextResponse } from "next/server";
import { getApiCallerProfile } from "@/lib/auth/api-session";
import { getAdminClient } from "@/lib/supabase/admin";
import { upsertAccountantStaffRow } from "@/lib/services/accountant-payroll-sync";
import type { PayrollEmployeeCategory } from "@/lib/services/payroll-persons";

/**
 * PATCH /api/payroll/update-compensation
 * تعديل راتب/وظيفة موظف — مساعد | خدمات | محاسب
 */
export async function PATCH(req: NextRequest) {
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
    const {
      category,
      id,
      base_salary,
      job_title_ar,
      doctor_share_percentage,
    } = body as {
      category: PayrollEmployeeCategory;
      id: string;
      base_salary: number;
      job_title_ar?: string;
      doctor_share_percentage?: number;
    };

    if (!id || !category) {
      return NextResponse.json({ error: "معرّف الموظف والنوع مطلوبان" }, { status: 400 });
    }

    const salary = Number(base_salary);
    if (!Number.isFinite(salary) || salary < 0) {
      return NextResponse.json({ error: "الراتب غير صالح" }, { status: 400 });
    }

    const admin = getAdminClient();

    if (category === "assistant") {
      const share = Math.min(
        100,
        Math.max(0, Number(doctor_share_percentage) || 0)
      );

      const { data: row } = await admin
        .from("assistants")
        .select("id")
        .eq("id", id)
        .eq("clinic_id", clinicId)
        .maybeSingle();

      if (!row) {
        return NextResponse.json({ error: "المساعد غير موجود" }, { status: 404 });
      }

      const { error } = await admin
        .from("assistants")
        .update({
          total_salary: salary,
          doctor_share_percentage: share,
        })
        .eq("id", id);

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }

      return NextResponse.json({ success: true, category, id });
    }

    if (category === "general" || category === "accountant") {
      const { data: staff } = await admin
        .from("staff_members")
        .select("id, profile_id")
        .eq("id", id)
        .eq("clinic_id", clinicId)
        .maybeSingle();

      if (!staff) {
        return NextResponse.json({ error: "الموظف غير موجود" }, { status: 404 });
      }

      const job =
        (job_title_ar || (staff.profile_id ? "محاسب" : "موظف خدمات")).trim();

      const { error: staffErr } = await admin
        .from("staff_members")
        .update({
          base_salary: salary,
          job_title_ar: job,
        })
        .eq("id", id);

      if (staffErr) {
        return NextResponse.json({ error: staffErr.message }, { status: 500 });
      }

      if (staff.profile_id) {
        const { error: profileErr } = await admin
          .from("profiles")
          .update({
            base_salary: salary,
            job_title: job,
          })
          .eq("id", staff.profile_id)
          .eq("clinic_id", clinicId);

        if (profileErr) {
          return NextResponse.json({ error: profileErr.message }, { status: 500 });
        }
      }

      return NextResponse.json({ success: true, category, id });
    }

    return NextResponse.json({ error: "نوع الموظف غير صالح" }, { status: 400 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "خطأ غير متوقع";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
