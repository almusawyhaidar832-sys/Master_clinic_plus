import { NextRequest, NextResponse } from "next/server";
import { getApiCallerProfile } from "@/lib/auth/api-session";
import { getAdminClient } from "@/lib/supabase/admin";
import {
  fetchPayrollMonthAdmin,
  generateMonthlyPayrollAdmin,
} from "@/lib/services/assistant-payroll-records-server";
import { recordPayrollGenerateTransactions } from "@/lib/services/payroll-financial";

/**
 * POST /api/payroll/generate
 * توليد رواتب الشهر لجميع العاملين: مساعدون + موظفو خدمات + محاسبون
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

    const body = await req.json().catch(() => ({}));
    const monthYear = (body as { month_year?: string }).month_year;

    if (!monthYear || !/^\d{4}-\d{2}$/.test(monthYear)) {
      return NextResponse.json(
        { error: "شهر العمل غير صالح (مثال: 2026-06)" },
        { status: 400 }
      );
    }

    const admin = getAdminClient();
    const result = await generateMonthlyPayrollAdmin(admin, clinicId, monthYear);

    if (!result.ok) {
      return NextResponse.json(
        {
          error: result.error ?? "تعذر توليد الرواتب",
          hint: "تأكد من تشغيل supabase/scripts/06-assistant-payroll-records.sql",
        },
        { status: 500 }
      );
    }

    const { records, slips } = await fetchPayrollMonthAdmin(
      admin,
      clinicId,
      monthYear
    );
    const txResult = await recordPayrollGenerateTransactions(
      admin,
      clinicId,
      monthYear,
      records,
      slips
    );

    return NextResponse.json({
      success: true,
      month_year: monthYear,
      assistantCreated: result.assistantCreated,
      assistantSkipped: result.assistantSkipped,
      generalCreated: result.generalCreated,
      generalSkipped: result.generalSkipped,
      totalCreated: result.assistantCreated + result.generalCreated,
      transactions_created: txResult.created,
      transaction_errors: txResult.errors.length ? txResult.errors : undefined,
      profit_updated: true,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "خطأ غير متوقع";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
