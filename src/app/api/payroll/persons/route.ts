import { NextRequest, NextResponse } from "next/server";
import { getApiCallerProfile } from "@/lib/auth/api-session";
import { getAdminClient } from "@/lib/supabase/admin";
import { fetchActivePayrollPersonsAdmin } from "@/lib/services/payroll-persons-server";

/**
 * GET /api/payroll/persons
 * قائمة موحدة: مساعدو الأطباء + موظفو الخدمات (قراءة موثوقة عبر service_role).
 */
export async function GET(req: NextRequest) {
  try {
    const caller = await getApiCallerProfile(req);
    if (!caller) {
      return NextResponse.json({ error: "يجب تسجيل الدخول أولاً" }, { status: 401 });
    }

    if (!["accountant", "super_admin"].includes(caller.role)) {
      return NextResponse.json(
        { error: "صلاحيات غير كافية — سجّل دخولك كمحاسب" },
        { status: 403 }
      );
    }

    const clinicId = caller.clinic_id;
    if (!clinicId) {
      return NextResponse.json(
        { error: "حسابك غير مربوط بعيادة" },
        { status: 400 }
      );
    }

    const admin = getAdminClient();
    const persons = await fetchActivePayrollPersonsAdmin(admin, clinicId);

    return NextResponse.json({ persons, count: persons.length });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "خطأ غير متوقع";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
