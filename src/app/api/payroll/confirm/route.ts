import { NextRequest, NextResponse } from "next/server";
import { getApiCallerProfile } from "@/lib/auth/api-session";
import { writeAuditLog } from "@/lib/audit/write-audit-log";
import { getAdminClient } from "@/lib/supabase/admin";
import {
  recordAssistantPayrollPaidTransaction,
  recordDoctorSalarySlipPaidTransaction,
  recordStaffSlipPaidTransaction,
} from "@/lib/services/payroll-financial";
import {
  recomputeAssistantPayrollRecord,
  syncStaffSalarySlipDraft,
} from "@/lib/services/salary-entries-server";
import {
  assistantIsFullyPaid,
  assistantPendingClinicShare,
  assistantPendingDoctorShare,
  slipIsFullyPaid,
  slipPendingNet,
} from "@/lib/services/payroll-paid-portions";
import {
  isDailyWage,
  isDailyWageAssistant,
  normalizeCompensationMode,
  normalizeAssistantCompensationMode,
} from "@/lib/services/assistant-compensation";
import type { PayrollRecord, SalarySlip } from "@/types";

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * POST /api/payroll/confirm
 * تأكيد صرف — يخصم من الربح **المبلغ المتبقي فقط** (جزئياً لأجر يومي)
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

      let activeSlip = slip as SalarySlip;
      if (!slip.doctor_id && slip.staff_id) {
        const synced = await syncStaffSalarySlipDraft(
          admin,
          clinicId,
          slip.staff_id as string,
          slip.month_year as string
        );
        if (synced.error && !synced.slip) {
          return NextResponse.json({ error: synced.error }, { status: 400 });
        }
        if (synced.slip) {
          activeSlip = synced.slip;
        }
      }

      if (slipIsFullyPaid(activeSlip, { dailyWage: isDailyStaff })) {
        return NextResponse.json({ success: true, already_paid: true });
      }

      const pending = slipPendingNet(activeSlip, { dailyWage: isDailyStaff });
      if (pending <= 0) {
        return NextResponse.json({ success: true, already_paid: true });
      }

      const tx = activeSlip.doctor_id
        ? await recordDoctorSalarySlipPaidTransaction(
            admin,
            clinicId,
            activeSlip,
            pending
          )
        : await recordStaffSlipPaidTransaction(
            admin,
            clinicId,
            activeSlip,
            pending,
            isDailyStaff
          );
      if (!tx.ok) {
        return NextResponse.json(
          { error: `تعذر تسجيل الحركة المالية: ${tx.error}` },
          { status: 500 }
        );
      }

      const confirmedAmount = roundMoney(tx.amount ?? pending);
      const newPaidNet = roundMoney(
        Number(activeSlip.paid_net_payout ?? 0) + confirmedAmount
      );

      const { error: paidUpdateErr } = await admin
        .from("salary_slips")
        .update({
          paid_net_payout: newPaidNet,
          paid_at: paidAt,
        })
        .eq("id", id);

      if (paidUpdateErr) {
        return NextResponse.json({ error: paidUpdateErr.message }, { status: 500 });
      }

      let finalSlip = activeSlip;
      if (isDailyStaff && activeSlip.staff_id) {
        const resynced = await syncStaffSalarySlipDraft(
          admin,
          clinicId,
          activeSlip.staff_id as string,
          activeSlip.month_year as string
        );
        if (resynced.slip) {
          finalSlip = resynced.slip;
        }
      } else {
        const fullNet = roundMoney(Number(activeSlip.net_payout ?? 0));
        const fullyPaid = newPaidNet >= fullNet;
        const { error: updateErr } = await admin
          .from("salary_slips")
          .update({
            status: fullyPaid ? "paid" : "draft",
          })
          .eq("id", id);
        if (updateErr) {
          return NextResponse.json({ error: updateErr.message }, { status: 500 });
        }
        finalSlip = {
          ...activeSlip,
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
        financialAmount: -Math.abs(confirmedAmount),
        after: {
          kind: "slip",
          status: fullyPaid ? "paid" : "draft",
          doctor_id: activeSlip.doctor_id ?? null,
          month_year: activeSlip.month_year ?? null,
          net_payout: Number(finalSlip.net_payout ?? 0),
          paid_net_payout: newPaidNet,
          confirmed_amount: confirmedAmount,
        },
        note: "تأكيد صرف راتب",
      });

      return NextResponse.json({
        success: true,
        kind: "slip",
        confirmed_amount: confirmedAmount,
        total_net: Number(finalSlip.net_payout ?? 0),
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

    const { record: freshRecord, error: recomputeErr } =
      await recomputeAssistantPayrollRecord(
        admin,
        clinicId,
        record.assistant_id as string,
        record.month_year as string
      );

    if (recomputeErr && !freshRecord) {
      return NextResponse.json({ error: recomputeErr }, { status: 400 });
    }

    const activeRecord = (freshRecord ?? record) as PayrollRecord;

    if (assistantIsFullyPaid(activeRecord, { dailyWage })) {
      return NextResponse.json({ success: true, already_paid: true });
    }

    const pendingDoctor = assistantPendingDoctorShare(activeRecord, { dailyWage });
    const pendingClinic = assistantPendingClinicShare(activeRecord, { dailyWage });

    if (pendingDoctor <= 0 && pendingClinic <= 0) {
      return NextResponse.json({ success: true, already_paid: true });
    }

    const tx = await recordAssistantPayrollPaidTransaction(
      admin,
      clinicId,
      activeRecord,
      { doctor: pendingDoctor, clinic: pendingClinic }
    );
    if (!tx.ok) {
      return NextResponse.json(
        { error: `تعذر خصم حصة الطبيب/العيادة: ${tx.error}` },
        { status: 500 }
      );
    }

    const newPaidDoctor = roundMoney(
      Number(activeRecord.paid_doctor_share_amount ?? 0) +
        (tx.doctorAmount ?? pendingDoctor)
    );
    const newPaidClinic = roundMoney(
      Number(activeRecord.paid_clinic_share_amount ?? 0) +
        (tx.clinicAmount ?? pendingClinic)
    );
    const newPaidTotal = roundMoney(
      Number(activeRecord.paid_total_salary ?? 0) +
        (dailyWage
          ? Number(activeRecord.total_salary ?? 0)
          : (tx.doctorAmount ?? 0) + (tx.clinicAmount ?? 0))
    );

    const { error: paidUpdateErr } = await admin
      .from("payroll_records")
      .update({
        paid_doctor_share_amount: newPaidDoctor,
        paid_clinic_share_amount: newPaidClinic,
        paid_total_salary: newPaidTotal,
        paid_at: paidAt,
      })
      .eq("id", id);

    if (paidUpdateErr) {
      return NextResponse.json({ error: paidUpdateErr.message }, { status: 500 });
    }

    const { record: finalRecord, error: finalRecomputeErr } =
      await recomputeAssistantPayrollRecord(
        admin,
        clinicId,
        record.assistant_id as string,
        record.month_year as string
      );
    if (finalRecomputeErr && !finalRecord) {
      return NextResponse.json({ error: finalRecomputeErr }, { status: 500 });
    }

    const resolvedRecord = (finalRecord ?? {
      ...activeRecord,
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
      financialAmount: -Math.abs(tx.clinicAmount ?? pendingClinic),
      after: {
        kind: "assistant",
        status: fullyPaid ? "paid" : "generated",
        doctor_id: activeRecord.doctor_id ?? null,
        month_year: activeRecord.month_year ?? null,
        confirmed_doctor: tx.doctorAmount ?? pendingDoctor,
        confirmed_clinic: tx.clinicAmount ?? pendingClinic,
      },
      note: "تأكيد صرف راتب مساعد",
    });

    const doctorId = activeRecord.doctor_id?.trim();
    if (doctorId) {
      void import("@/lib/notifications/server")
        .then(({ notifyDoctorAssistantPayrollConfirmed }) =>
          notifyDoctorAssistantPayrollConfirmed({
            clinicId,
            doctorId,
            assistantName: String(activeRecord.assistant_name_ar ?? "مساعد"),
            monthYear: String(activeRecord.month_year ?? ""),
            doctorDeducted: tx.doctorAmount ?? pendingDoctor,
            clinicDeducted: tx.clinicAmount ?? pendingClinic,
          })
        )
        .catch((err) => {
          console.error("[payroll-confirm] doctor notify failed:", err);
        });
    }

    return NextResponse.json({
      success: true,
      kind: "assistant",
      doctor_id: activeRecord.doctor_id ?? null,
      doctor_deducted: tx.doctorAmount ?? pendingDoctor,
      clinic_deducted: tx.clinicAmount ?? pendingClinic,
      total_salary: Number(resolvedRecord.total_salary ?? 0),
      profit_updated: true,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "خطأ غير متوقع";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
