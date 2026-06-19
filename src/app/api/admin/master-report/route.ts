import { NextRequest, NextResponse } from "next/server";
import { getApiCallerProfile } from "@/lib/auth/api-session";
import { getAdminClient } from "@/lib/supabase/admin";
import { fetchMasterClinicReport } from "@/lib/services/clinic-reports";
import { currentMonthYear } from "@/lib/utils";

/** GET /api/admin/master-report?monthYear= — تقرير المالك بنفس مصدر بيانات المحاسب */
export async function GET(req: NextRequest) {
  try {
    const caller = await getApiCallerProfile(req);
    if (!caller) {
      return NextResponse.json({ error: "يجب تسجيل الدخول أولاً" }, { status: 401 });
    }
    if (caller.role !== "super_admin") {
      return NextResponse.json({ error: "صلاحيات غير كافية" }, { status: 403 });
    }

    const clinicId = caller.clinic_id;
    if (!clinicId) {
      return NextResponse.json({ error: "حسابك غير مربوط بعيادة" }, { status: 400 });
    }

    const monthYear =
      req.nextUrl.searchParams.get("monthYear")?.trim() || currentMonthYear();

    const admin = getAdminClient();
    const report = await fetchMasterClinicReport(admin, monthYear, clinicId);

    return NextResponse.json(report);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "خطأ غير متوقع";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
