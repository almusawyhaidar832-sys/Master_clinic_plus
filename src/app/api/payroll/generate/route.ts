import { NextRequest, NextResponse } from "next/server";
import { writeAuditLog } from "@/lib/audit/write-audit-log";
import { resolvePayrollApiClinic } from "@/lib/auth/resolve-payroll-clinic";
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
    const body = await req.json().catch(() => ({}));
    const resolved = await resolvePayrollApiClinic(req, {
      requestedClinicId: (body as { clinic_id?: string }).clinic_id,
    });
    if (!resolved.ok) {
      return NextResponse.json(
        { error: resolved.error },
        { status: resolved.status }
      );
    }

    const { clinicId, caller } = resolved;
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

    if (txResult.errors.length > 0) {
      return NextResponse.json(
        {
          success: false,
          error:
            "تم توليد سجلات الرواتب لكن فشل تسجيل جزء من القيود المحاسبية — راجع اللوحة التنفيذية قبل تأكيد الصرف",
          month_year: monthYear,
          assistantCreated: result.assistantCreated,
          assistantUpdated: result.assistantUpdated,
          assistantSkipped: result.assistantSkipped,
          generalCreated: result.generalCreated,
          generalUpdated: result.generalUpdated,
          generalSkipped: result.generalSkipped,
          doctorSalaryCreated: result.doctorSalaryCreated,
          doctorSalaryUpdated: result.doctorSalaryUpdated,
          doctorSalarySkipped: result.doctorSalarySkipped,
          transactions_created: txResult.created,
          transaction_errors: txResult.errors,
        },
        { status: 500 }
      );
    }

    await writeAuditLog(admin, {
      clinicId,
      entityType: "payroll",
      entityId: monthYear,
      action: "create",
      changedBy: caller.id,
      actorName: caller.full_name ?? null,
      after: {
        month_year: monthYear,
        records_count: records.length,
        slips_count: slips.length,
        transactions_created: txResult.created,
      },
      note: `توليد رواتب ${monthYear}`,
    });

    return NextResponse.json({
      success: true,
      month_year: monthYear,
      assistantCreated: result.assistantCreated,
      assistantUpdated: result.assistantUpdated,
      assistantSkipped: result.assistantSkipped,
      generalCreated: result.generalCreated,
      generalUpdated: result.generalUpdated,
      generalSkipped: result.generalSkipped,
      doctorSalaryCreated: result.doctorSalaryCreated,
      doctorSalaryUpdated: result.doctorSalaryUpdated,
      doctorSalarySkipped: result.doctorSalarySkipped,
      totalCreated:
        result.assistantCreated +
        result.assistantUpdated +
        result.generalCreated +
        result.generalUpdated +
        result.doctorSalaryCreated +
        result.doctorSalaryUpdated,
      transactions_created: txResult.created,
      profit_updated: true,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "خطأ غير متوقع";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
