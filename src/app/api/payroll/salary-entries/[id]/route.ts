import { NextRequest, NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { payrollClinicQueryParam, resolvePayrollApiClinic } from "@/lib/auth/resolve-payroll-clinic";
import {
  deleteSalaryEntry,
  updateSalaryEntry,
} from "@/lib/services/salary-entries-server";

type RouteContext = { params: Promise<{ id: string }> };

/** PATCH /api/payroll/salary-entries/[id] — تعديل حركة راتب */
export async function PATCH(req: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const body = await req.json();
    const resolved = await resolvePayrollApiClinic(req, {
      requestedClinicId:
        body.clinic_id != null ? String(body.clinic_id) : null,
    });
    if (!resolved.ok) {
      return NextResponse.json(
        { error: resolved.error },
        { status: resolved.status }
      );
    }

    const amount =
      body.amount != null && body.amount !== ""
        ? Number(body.amount)
        : undefined;
    const entryDate =
      body.entry_date != null ? String(body.entry_date).trim() : undefined;
    const notesAr =
      body.notes_ar !== undefined
        ? body.notes_ar != null
          ? String(body.notes_ar)
          : null
        : undefined;

    if (amount != null && (!Number.isFinite(amount) || amount <= 0)) {
      return NextResponse.json(
        { error: "أدخل مبلغاً أكبر من صفر" },
        { status: 400 }
      );
    }

    const admin = getAdminClient();
    const result = await updateSalaryEntry(admin, resolved.clinicId, id, {
      amount,
      entryDate,
      notesAr,
    });

    if (result.error && !result.entry) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json({
      success: true,
      entry: result.entry,
      entries: result.entries,
      slip: result.slip,
      payroll_record: result.payrollRecord,
      net_payout: result.netPayout,
      warning: result.notice ?? result.error,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "خطأ غير متوقع";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/** DELETE /api/payroll/salary-entries/[id] — حذف حركة راتب */
export async function DELETE(req: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const resolved = await resolvePayrollApiClinic(req, {
      requestedClinicId: payrollClinicQueryParam(req),
    });
    if (!resolved.ok) {
      return NextResponse.json(
        { error: resolved.error },
        { status: resolved.status }
      );
    }

    const admin = getAdminClient();
    const result = await deleteSalaryEntry(admin, resolved.clinicId, id);

    if (result.error && !result.deleted) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json({
      success: true,
      entries: result.entries,
      slip: result.slip,
      payroll_record: result.payrollRecord,
      net_payout: result.netPayout,
      warning: result.notice ?? result.error,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "خطأ غير متوقع";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
