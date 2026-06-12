import { NextRequest, NextResponse } from "next/server";
import { getApiCallerProfile } from "@/lib/auth/api-session";
import { getAdminClient } from "@/lib/supabase/admin";
import {
  recordAssistantPayrollPaidTransaction,
  recordDoctorSalarySlipPaidTransaction,
  recordStaffSlipPaidTransaction,
} from "@/lib/services/payroll-financial";
import type { PayrollRecord, SalarySlip } from "@/types";

/**
 * POST /api/payroll/confirm
 * تأكيد صرف راتب — حركة مالية + تحديث الحالة
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

    const body = await req.json();
    const kind = body.kind as "slip" | "assistant";
    const id = String(body.id ?? "");

    if (!id || !["slip", "assistant"].includes(kind)) {
      return NextResponse.json(
        { error: "kind (slip|assistant) و id مطلوبان" },
        { status: 400 }
      );
    }

    const admin = getAdminClient();
    const paidAt = new Date().toISOString();

    if (kind === "slip") {
      const { data: slip, error: fetchErr } = await admin
        .from("salary_slips")
        .select("*")
        .eq("id", id)
        .eq("clinic_id", clinicId)
        .maybeSingle();

      if (fetchErr || !slip) {
        return NextResponse.json({ error: "القسيمة غير موجودة" }, { status: 404 });
      }
      if (slip.status === "paid") {
        return NextResponse.json({ success: true, already_paid: true });
      }

      const { error: updateErr } = await admin
        .from("salary_slips")
        .update({ status: "paid", paid_at: paidAt })
        .eq("id", id);

      if (updateErr) {
        return NextResponse.json({ error: updateErr.message }, { status: 500 });
      }

      const tx = slip.doctor_id
        ? await recordDoctorSalarySlipPaidTransaction(
            admin,
            clinicId,
            slip as SalarySlip
          )
        : await recordStaffSlipPaidTransaction(
            admin,
            clinicId,
            slip as SalarySlip
          );
      if (!tx.ok) {
        return NextResponse.json(
          { error: `تم التأكيد لكن فشل الحركة المالية: ${tx.error}` },
          { status: 500 }
        );
      }

      return NextResponse.json({ success: true, kind: "slip", profit_updated: true });
    }

    const { data: record, error: recErr } = await admin
      .from("payroll_records")
      .select("*")
      .eq("id", id)
      .eq("clinic_id", clinicId)
      .maybeSingle();

    if (recErr || !record) {
      return NextResponse.json({ error: "سجل الراتب غير موجود" }, { status: 404 });
    }
    if (record.status === "paid") {
      return NextResponse.json({ success: true, already_paid: true });
    }

    const { error: updateErr } = await admin
      .from("payroll_records")
      .update({ status: "paid", paid_at: paidAt })
      .eq("id", id);

    if (updateErr) {
      return NextResponse.json({ error: updateErr.message }, { status: 500 });
    }

    const tx = await recordAssistantPayrollPaidTransaction(
      admin,
      clinicId,
      record as PayrollRecord
    );
    if (!tx.ok) {
      return NextResponse.json(
        { error: `تم التأكيد لكن فشل خصم الطبيب: ${tx.error}` },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      kind: "assistant",
      doctor_deducted: Number(record.doctor_share_amount ?? 0),
      profit_updated: true,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "خطأ غير متوقع";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
