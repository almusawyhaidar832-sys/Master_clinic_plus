import { NextRequest, NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";
import {
  payrollClinicQueryParam,
  resolvePayrollApiClinic,
} from "@/lib/auth/resolve-payroll-clinic";
import { fetchActivePayrollPersonsAdmin } from "@/lib/services/payroll-persons-server";

/**
 * GET /api/payroll/persons?clinic_id=
 * قائمة موحدة: مساعدو الأطباء + موظفو الخدمات (قراءة موثوقة عبر service_role).
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
    const persons = await fetchActivePayrollPersonsAdmin(admin, clinicId);

    return NextResponse.json({
      clinic_id: clinicId,
      persons,
      count: persons.length,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "خطأ غير متوقع";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
