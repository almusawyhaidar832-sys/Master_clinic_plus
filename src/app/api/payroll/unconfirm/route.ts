import { NextRequest, NextResponse } from "next/server";
import { getApiCallerProfile } from "@/lib/auth/api-session";
import { writeAuditLog } from "@/lib/audit/write-audit-log";
import { getAdminClient } from "@/lib/supabase/admin";
import {
  isDailyWage,
  isDailyWageAssistant,
  normalizeAssistantCompensationMode,
  normalizeCompensationMode,
} from "@/lib/services/assistant-compensation";
import { isMonthClosed } from "@/lib/services/salary-payroll";
import {
  reverseLastAssistantPayrollPaidTransaction,
  reverseLastStaffSlipPaidTransaction,
} from "@/lib/services/payroll-financial";
import {
  assistantIsFullyPaid,
  assistantPaidClinicShare,
  assistantPaidDoctorShare,
  assistantPaidTotalSalary,
  slipIsFullyPaid,
  slipPaidNet,
} from "@/lib/services/payroll-paid-portions";
import {
  recomputeAssistantPayrollRecord,
  syncStaffSalarySlipDraft,
} from "@/lib/services/salary-entries-server";
import type { PayrollRecord, SalarySlip } from "@/types";

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * POST /api/payroll/unconfirm
 * إلغاء **آخر** تأكيد صرف — إرجاع جزء من المبلغ المؤكَّد فقط
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

      const paidNet = slipPaidNet(slip as SalarySlip);
      if (paidNet <= 0) {
        return NextResponse.json({ success: true, already_unpaid: true });
      }

      let isDailyStaff = false;
      if (!slip.doctor_id && slip.staff_id) {
        const { data: staffRow } = await admin
          .from("staff_members")
          .select("compensation_mode")
          .eq("id", slip.staff_id)
          .eq("clinic_id", clinicId)
          .maybeSingle();
        isDailyStaff = isDailyWage(
          normalizeCompensationMode(staffRow?.compensation_mode as string | undefined)
        );
      }

      const monthYear = slip.month_year as string;
      if (await isMonthClosed(admin, clinicId, monthYear)) {
        return NextResponse.json(
          { error: "الشهر مُغلق — لا يمكن إلغاء الصرف" },
          { status: 400 }
        );
      }

      const tx = await reverseLastStaffSlipPaidTransaction(
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

      const reversed = roundMoney(tx.reversedAmount ?? 0);
      const newPaidNet = roundMoney(Math.max(0, paidNet - reversed));

      const { error: paidUpdateErr } = await admin
        .from("salary_slips")
        .update({
          paid_net_payout: newPaidNet,
          paid_at: newPaidNet > 0 ? slip.paid_at : null,
        })
        .eq("id", id);

      if (paidUpdateErr) {
        return NextResponse.json({ error: paidUpdateErr.message }, { status: 500 });
      }

      let finalSlip = slip as SalarySlip;
      if (isDailyStaff && slip.staff_id) {
        const resynced = await syncStaffSalarySlipDraft(
          admin,
          clinicId,
          slip.staff_id as string,
          monthYear
        );
        if (resynced.slip) {
          finalSlip = resynced.slip;
        }
      } else {
        const fullyPaid = slipIsFullyPaid(
          { ...(slip as SalarySlip), paid_net_payout: newPaidNet },
          { dailyWage: false }
        );
        await admin
          .from("salary_slips")
          .update({ status: fullyPaid ? "paid" : "draft" })
          .eq("id", id);
        finalSlip = {
          ...(slip as SalarySlip),
          paid_net_payout: newPaidNet,
          status: fullyPaid ? "paid" : "draft",
        };
      }

      const fullyPaid = slipIsFullyPaid(finalSlip, { dailyWage: isDailyStaff });

      await writeAuditLog(admin, {
        clinicId,
        entityType: "payroll",
        entityId: id,
        action: "update",
        changedBy: caller.id,
        actorName: caller.full_name ?? null,
        financialAmount: reversed,
        after: {
          kind: "slip",
          status: fullyPaid ? "paid" : "draft",
          doctor_id: slip.doctor_id ?? null,
          month_year: monthYear,
          reversed_amount: reversed,
          paid_net_payout: newPaidNet,
          net_payout: Number(finalSlip.net_payout ?? 0),
        },
        note: "إلغاء آخر تأكيد صرف راتب",
      });

      return NextResponse.json({
        success: true,
        kind: "slip",
        reversed_amount: reversed,
        paid_net_payout: newPaidNet,
        profit_updated: true,
      });
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

    const paidDoctor = assistantPaidDoctorShare(record as PayrollRecord);
    const paidClinic = assistantPaidClinicShare(record as PayrollRecord);
    const paidTotal = assistantPaidTotalSalary(record as PayrollRecord);
    if (paidDoctor <= 0 && paidClinic <= 0 && paidTotal <= 0) {
      return NextResponse.json({ success: true, already_unpaid: true });
    }

    const { data: assistantRow } = await admin
      .from("assistants")
      .select("compensation_mode")
      .eq("id", record.assistant_id)
      .eq("clinic_id", clinicId)
      .maybeSingle();
    const dailyWage = isDailyWageAssistant(
      normalizeAssistantCompensationMode(
        assistantRow?.compensation_mode as string | undefined
      )
    );

    const monthYear = record.month_year as string;
    if (await isMonthClosed(admin, clinicId, monthYear)) {
      return NextResponse.json(
        { error: "الشهر مُغلق — لا يمكن إلغاء الصرف" },
        { status: 400 }
      );
    }

    const tx = await reverseLastAssistantPayrollPaidTransaction(
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

    const newPaidDoctor = roundMoney(
      Math.max(0, paidDoctor - (tx.reversedDoctor ?? 0))
    );
    const newPaidClinic = roundMoney(
      Math.max(0, paidClinic - (tx.reversedClinic ?? 0))
    );
    const reversedTotal = roundMoney(
      (tx.reversedDoctor ?? 0) + (tx.reversedClinic ?? 0)
    );
    const newPaidTotal = roundMoney(Math.max(0, paidTotal - reversedTotal));

    const { error: paidUpdateErr } = await admin
      .from("payroll_records")
      .update({
        paid_doctor_share_amount: newPaidDoctor,
        paid_clinic_share_amount: newPaidClinic,
        paid_total_salary: newPaidTotal,
        paid_at: newPaidTotal > 0 ? record.paid_at : null,
      })
      .eq("id", id);

    if (paidUpdateErr) {
      return NextResponse.json({ error: paidUpdateErr.message }, { status: 500 });
    }

    const { record: finalRecord } = await recomputeAssistantPayrollRecord(
      admin,
      clinicId,
      record.assistant_id as string,
      monthYear
    );
    const resolvedRecord = (finalRecord ?? {
      ...record,
      paid_doctor_share_amount: newPaidDoctor,
      paid_clinic_share_amount: newPaidClinic,
      paid_total_salary: newPaidTotal,
    }) as PayrollRecord;
    const fullyPaid = assistantIsFullyPaid(resolvedRecord, { dailyWage });

    await writeAuditLog(admin, {
      clinicId,
      entityType: "payroll",
      entityId: id,
      action: "update",
      changedBy: caller.id,
      actorName: caller.full_name ?? null,
      financialAmount: tx.reversedClinic ?? 0,
      after: {
        kind: "assistant",
        status: fullyPaid ? "paid" : "generated",
        doctor_id: record.doctor_id ?? null,
        month_year: monthYear,
        reversed_doctor: tx.reversedDoctor ?? 0,
        reversed_clinic: tx.reversedClinic ?? 0,
        total_salary: Number(resolvedRecord.total_salary ?? 0),
      },
      note: "إلغاء آخر تأكيد صرف راتب مساعد",
    });

    return NextResponse.json({
      success: true,
      kind: "assistant",
      reversed_doctor: tx.reversedDoctor ?? 0,
      reversed_clinic: tx.reversedClinic ?? 0,
      profit_updated: true,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "خطأ غير متوقع";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
