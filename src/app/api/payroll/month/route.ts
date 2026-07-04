import { NextRequest, NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";
import {
  payrollClinicQueryParam,
  resolvePayrollApiClinic,
} from "@/lib/auth/resolve-payroll-clinic";
import { fetchPayrollMonthAdmin } from "@/lib/services/assistant-payroll-records-server";

/**
 * GET /api/payroll/month?clinic_id=&month_year=2026-06
 * جلب رواتب الشهر المُولَّدة (مساعدون + قسائم الموظفين)
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

    const monthYear = req.nextUrl.searchParams.get("month_year");
    if (!monthYear || !/^\d{4}-\d{2}$/.test(monthYear)) {
      return NextResponse.json(
        { error: "month_year مطلوب (مثال: 2026-06)" },
        { status: 400 }
      );
    }

    const { clinicId } = resolved;
    const admin = getAdminClient();
    const { records, slips } = await fetchPayrollMonthAdmin(
      admin,
      clinicId,
      monthYear
    );

    return NextResponse.json({
      clinic_id: clinicId,
      records,
      slips,
      count: records.length + slips.length,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "خطأ غير متوقع";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
