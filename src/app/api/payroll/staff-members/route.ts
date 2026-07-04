import { NextRequest, NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";
import {
  payrollClinicQueryParam,
  resolvePayrollApiClinic,
} from "@/lib/auth/resolve-payroll-clinic";

/**
 * GET /api/payroll/staff-members?clinic_id=
 * موظفو الخدمات النشطون — قراءة موثوقة عبر service_role.
 */
export async function GET(req: NextRequest) {
  try {
    const resolved = await resolvePayrollApiClinic(req, {
      requestedClinicId: payrollClinicQueryParam(req),
    });
    if (!resolved.ok) {
      return NextResponse.json(
        { error: resolved.error },
        { status: resolved.status }
      );
    }

    const { clinicId } = resolved;
    const admin = getAdminClient();
    const { data, error } = await admin
      .from("staff_members")
      .select("*")
      .eq("clinic_id", clinicId)
      .eq("is_active", true)
      .order("full_name_ar");

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ clinic_id: clinicId, staff: data ?? [] });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "خطأ غير متوقع";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
