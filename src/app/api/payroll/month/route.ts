import { NextRequest, NextResponse } from "next/server";
import { getApiCallerProfile } from "@/lib/auth/api-session";
import { getAdminClient } from "@/lib/supabase/admin";
import { fetchPayrollMonthAdmin } from "@/lib/services/assistant-payroll-records-server";

/**
 * GET /api/payroll/month?month_year=2026-06
 * جلب رواتب الشهر المُولَّدة (مساعدون + قسائم الموظفين)
 */
export async function GET(req: NextRequest) {
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

    const monthYear = req.nextUrl.searchParams.get("month_year");
    if (!monthYear || !/^\d{4}-\d{2}$/.test(monthYear)) {
      return NextResponse.json({ error: "month_year مطلوب (مثال: 2026-06)" }, { status: 400 });
    }

    const admin = getAdminClient();
    const { records, slips } = await fetchPayrollMonthAdmin(
      admin,
      clinicId,
      monthYear
    );

    return NextResponse.json({
      records,
      slips,
      count: records.length + slips.length,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "خطأ غير متوقع";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
