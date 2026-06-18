import { NextRequest, NextResponse } from "next/server";
import { getApiCallerProfile } from "@/lib/auth/api-session";
import { getAdminClient } from "@/lib/supabase/admin";
import type { PayrollPerson } from "@/lib/services/payroll-persons";

/**
 * POST /api/payroll/add-employee
 * إضافة موظف خدمات أو مساعد طبيب — عبر service_role بعد التحقق من الجلسة.
 */
export async function POST(req: NextRequest) {
  try {
    const caller = await getApiCallerProfile(req);
    if (!caller) {
      return NextResponse.json({ error: "يجب تسجيل الدخول أولاً" }, { status: 401 });
    }

    if (!["accountant", "super_admin"].includes(caller.role)) {
      return NextResponse.json(
        {
          error: `دورك (${caller.role}) لا يملك صلاحية إضافة موظفين — سجّل دخولك كمحاسب`,
        },
        { status: 403 }
      );
    }

    const clinicId = caller.clinic_id;
    if (!clinicId) {
      return NextResponse.json(
        { error: "حسابك غير مربوط بعيادة — نفّذ link_profile_to_first_clinic()" },
        { status: 400 }
      );
    }

    const body = await req.json();
    const {
      employee_type,
      full_name_ar,
      base_salary,
      job_title_ar = "موظف خدمات",
      doctor_id = null,
      doctor_share_percentage = 0,
      compensation_mode = "monthly_fixed",
    } = body as {
      employee_type: "general" | "assistant";
      full_name_ar: string;
      base_salary: number;
      job_title_ar?: string;
      doctor_id?: string | null;
      doctor_share_percentage?: number;
      compensation_mode?: "monthly_fixed" | "daily_wage";
    };

    if (!full_name_ar?.trim()) {
      return NextResponse.json({ error: "الاسم مطلوب" }, { status: 400 });
    }

    const salary = Number(base_salary);
    if (!Number.isFinite(salary) || salary < 0) {
      return NextResponse.json({ error: "الراتب غير صالح" }, { status: 400 });
    }

    const admin = getAdminClient();

    if (employee_type === "general") {
      const { data: slotRows } = await admin
        .from("staff_members")
        .select("slot_number")
        .eq("clinic_id", clinicId);

      const nextSlot =
        (slotRows ?? []).reduce(
          (max, s) => Math.max(max, s.slot_number ?? 0),
          0
        ) + 1;

      const { data: inserted, error } = await admin
        .from("staff_members")
        .insert({
          clinic_id: clinicId,
          full_name_ar: full_name_ar.trim(),
          job_title_ar: (job_title_ar || "موظف خدمات").trim(),
          base_salary: salary,
          slot_number: nextSlot,
          is_active: true,
        })
        .select("id")
        .single();

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }

      const job = (job_title_ar || "موظف خدمات").trim();
      const person: PayrollPerson = {
        id: inserted.id,
        name: full_name_ar.trim(),
        role: job,
        category: "general",
        full_name_ar: full_name_ar.trim(),
        job_title_ar: job,
        base_salary: salary,
        is_active: true,
      };

      return NextResponse.json({
        success: true,
        id: inserted.id,
        category: "general",
        payroll_key: `general:${inserted.id}`,
        person,
      });
    }

    if (employee_type === "assistant") {
      if (!doctor_id) {
        return NextResponse.json({ error: "اختر الطبيب المسؤول" }, { status: 400 });
      }

      const share = Math.min(100, Math.max(0, Number(doctor_share_percentage) || 0));
      const mode =
        compensation_mode === "daily_wage" ? "daily_wage" : "monthly_fixed";
      const assistantSalary =
        mode === "daily_wage" ? 0 : salary;

      const { data: doctor } = await admin
        .from("doctors")
        .select("id, clinic_id")
        .eq("id", doctor_id)
        .maybeSingle();

      if (!doctor || doctor.clinic_id !== clinicId) {
        return NextResponse.json({ error: "الطبيب غير موجود في عيادتك" }, { status: 400 });
      }

      const { data: inserted, error } = await admin
        .from("assistants")
        .insert({
          clinic_id: clinicId,
          doctor_id,
          full_name_ar: full_name_ar.trim(),
          total_salary: assistantSalary,
          doctor_share_percentage: share,
          compensation_mode: mode,
          is_active: true,
        })
        .select("id")
        .single();

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }

      const { data: doctorRow } = await admin
        .from("doctors")
        .select("full_name_ar")
        .eq("id", doctor_id)
        .maybeSingle();

      const doctorName = doctorRow?.full_name_ar as string | undefined;
      const rolePrefix = mode === "daily_wage" ? "مساعد يومي" : "مساعد";
      const role = doctorName ? `${rolePrefix} — ${doctorName}` : `${rolePrefix} طبيب`;
      const person: PayrollPerson = {
        id: inserted.id,
        name: full_name_ar.trim(),
        role,
        category: "assistant",
        full_name_ar: full_name_ar.trim(),
        job_title_ar: role,
        base_salary: assistantSalary,
        doctor_id,
        doctor_name_ar: doctorName ?? null,
        doctor_share_percentage: share,
        compensation_mode: mode,
        is_active: true,
      };

      return NextResponse.json({
        success: true,
        id: inserted.id,
        category: "assistant",
        payroll_key: `assistant:${inserted.id}`,
        person,
      });
    }

    return NextResponse.json({ error: "نوع الموظف غير صالح" }, { status: 400 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "خطأ غير متوقع";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
