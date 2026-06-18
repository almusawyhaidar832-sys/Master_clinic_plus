import { NextRequest, NextResponse } from "next/server";
import { getApiCallerProfile } from "@/lib/auth/api-session";
import { writeAuditLog } from "@/lib/audit/write-audit-log";
import { getAdminClient } from "@/lib/supabase/admin";
import { isMonthClosed } from "@/lib/services/salary-payroll";
import {
  reverseAssistantPayrollPaidTransaction,
  reverseStaffSlipPaidTransaction,
} from "@/lib/services/payroll-financial";
import type { PayrollRecord, SalarySlip } from "@/types";

/**
 * POST /api/payroll/unconfirm
 * إلغاء تأكيد صرف — إرجاع الحالة + حذف حركة الصرف
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
      if (slip.status !== "paid") {
        return NextResponse.json({ success: true, already_unpaid: true });
      }

      const monthYear = slip.month_year as string;
      if (await isMonthClosed(admin, clinicId, monthYear)) {
        return NextResponse.json(
          { error: "الشهر مُغلق — لا يمكن إلغاء الصرف" },
          { status: 400 }
        );
      }

      const tx = await reverseStaffSlipPaidTransaction(
        admin,
        clinicId,
        slip as SalarySlip
      );
      if (!tx.ok) {
        return NextResponse.json(
          { error: tx.error ?? "تعذر عكس الحركة المالية" },
          { status: 500 }
        );
      }

      const { error: updateErr } = await admin
        .from("salary_slips")
        .update({ status: "draft", paid_at: null })
        .eq("id", id);

      if (updateErr) {
        return NextResponse.json({ error: updateErr.message }, { status: 500 });
      }

      await writeAuditLog(admin, {
        clinicId,
        entityType: "payroll",
        entityId: id,
        action: "update",
        changedBy: caller.id,
        actorName: caller.full_name ?? null,
        financialAmount: Math.abs(Number(slip.net_payout ?? 0)),
        after: {
          kind: "slip",
          status: "draft",
          doctor_id: slip.doctor_id ?? null,
          month_year: monthYear,
        },
        note: "إلغاء تأكيد صرف راتب",
      });

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
    if (record.status !== "paid") {
      return NextResponse.json({ success: true, already_unpaid: true });
    }

    const monthYear = record.month_year as string;
    if (await isMonthClosed(admin, clinicId, monthYear)) {
      return NextResponse.json(
        { error: "الشهر مُغلق — لا يمكن إلغاء الصرف" },
        { status: 400 }
      );
    }

    const tx = await reverseAssistantPayrollPaidTransaction(
      admin,
      clinicId,
      record as PayrollRecord
    );
    if (!tx.ok) {
      return NextResponse.json(
        { error: tx.error ?? "تعذر عكس خصم الطبيب" },
        { status: 500 }
      );
    }

    const { error: updateErr } = await admin
      .from("payroll_records")
      .update({ status: "generated", paid_at: null })
      .eq("id", id);

    if (updateErr) {
      return NextResponse.json({ error: updateErr.message }, { status: 500 });
    }

    await writeAuditLog(admin, {
      clinicId,
      entityType: "payroll",
      entityId: id,
      action: "update",
      changedBy: caller.id,
      actorName: caller.full_name ?? null,
      financialAmount: Math.abs(Number(record.doctor_share_amount ?? 0)),
      after: {
        kind: "assistant",
        status: "generated",
        doctor_id: record.doctor_id ?? null,
        month_year: monthYear,
      },
      note: "إلغاء تأكيد صرف راتب مساعد",
    });

    return NextResponse.json({
      success: true,
      kind: "assistant",
      profit_updated: true,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "خطأ غير متوقع";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
