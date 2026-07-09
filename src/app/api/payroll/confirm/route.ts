import { NextRequest, NextResponse } from "next/server";
import { getApiCallerProfile } from "@/lib/auth/api-session";
import { writeAuditLog } from "@/lib/audit/write-audit-log";
import { getAdminClient } from "@/lib/supabase/admin";
import { isMonthClosed } from "@/lib/services/salary-payroll";
import {
  isAssistantDailyEntryConfirmed,
  recordAssistantDailyEntryPaidTransaction,
  recordAssistantPayrollPaidTransaction,
  recordDoctorSalarySlipPaidTransaction,
  recordStaffSlipPaidTransaction,
} from "@/lib/services/payroll-financial";
import {
  ensureAssistantPayrollRecordDraft,
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
import type { PayrollRecord, SalarySlip } from "@/types";

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * POST /api/payroll/confirm
 * تأكيد صرف — يخصم فوراً من ربح العيادة (assistant_payroll_clinic)
 * ومن محفظة الطبيب (assistant_payroll_doctor) — المبلغ المتبقي فقط
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
    const kind = body.kind as "slip" | "assistant" | "assistant_entry";
    const id = String(body.id ?? "");

    if (!id || !["slip", "assistant", "assistant_entry"].includes(kind)) {
      return NextResponse.json(
        { error: "kind (slip|assistant|assistant_entry) و id مطلوبان" },
        { status: 400 }
      );
    }

    const admin = getAdminClient();
    const paidAt = new Date().toISOString();

    if (kind === "assistant_entry") {
      const { data: entry, error: entryErr } = await admin
        .from("salary_entries")
        .select("*")
        .eq("id", id)
        .eq("clinic_id", clinicId)
        .maybeSingle();

      if (entryErr || !entry) {
        return NextResponse.json({ error: "حركة الراتب غير موجودة" }, { status: 404 });
      }

      const assistantId = String(entry.assistant_id ?? "").trim();
      if (!assistantId) {
        return NextResponse.json(
          { error: "هذه الحركة ليست لمساعد طبيب" },
          { status: 400 }
        );
      }

      if (entry.entry_type !== "daily_wage") {
        return NextResponse.json(
          { error: "تأكيد الحركة الفردية متاح لأجر يومي فقط" },
          { status: 400 }
        );
      }

      const entryMonth = String(entry.entry_date ?? "").slice(0, 7);
      if (!entryMonth) {
        return NextResponse.json({ error: "تاريخ الحركة غير صالح" }, { status: 400 });
      }

      if (await isMonthClosed(admin, clinicId, entryMonth)) {
        return NextResponse.json(
          { error: "الشهر مُغلق — لا يمكن تأكيد الصرف" },
          { status: 400 }
        );
      }

      if (await isAssistantDailyEntryConfirmed(admin, clinicId, id)) {
        return NextResponse.json({ success: true, already_paid: true });
      }

      const ensured = await ensureAssistantPayrollRecordDraft(
        admin,
        clinicId,
        assistantId,
        entryMonth
      );
      if (ensured.error && !ensured.record) {
        return NextResponse.json({ error: ensured.error }, { status: 400 });
      }

      const { record: freshRecord, error: recomputeErr, dailyWage } =
        await recomputeAssistantPayrollRecord(
          admin,
          clinicId,
          assistantId,
          entryMonth
        );

      if (recomputeErr && !freshRecord) {
        return NextResponse.json({ error: recomputeErr }, { status: 400 });
      }

      if (!freshRecord) {
        return NextResponse.json(
          { error: "لا يوجد سجل راتب للمساعد في هذا الشهر" },
          { status: 404 }
        );
      }

      const activeRecord = freshRecord as PayrollRecord;
      const { data: assistantRow } = await admin
        .from("assistants")
        .select("doctor_share_percentage, full_name_ar")
        .eq("id", assistantId)
        .eq("clinic_id", clinicId)
        .maybeSingle();

      const doctorSharePct = Number(
        assistantRow?.doctor_share_percentage ??
          activeRecord.doctor_share_percentage ??
          0
      );

      const tx = await recordAssistantDailyEntryPaidTransaction(
        admin,
        clinicId || activeRecord.clinic_id,
        activeRecord,
        id,
        Number(entry.amount ?? 0),
        doctorSharePct,
        String(assistantRow?.full_name_ar ?? activeRecord.assistant_name_ar ?? "مساعد"),
        entryMonth
      );

      if (!tx.ok) {
        return NextResponse.json(
          { error: `تعذر خصم حصة الطبيب/العيادة: ${tx.error}` },
          { status: 500 }
        );
      }

      const newPaidDoctor = roundMoney(
        Number(activeRecord.paid_doctor_share_amount ?? 0) + (tx.doctorAmount ?? 0)
      );
      const newPaidClinic = roundMoney(
        Number(activeRecord.paid_clinic_share_amount ?? 0) + (tx.clinicAmount ?? 0)
      );
      const newPaidTotal = roundMoney(
        Number(activeRecord.paid_total_salary ?? 0) +
          (tx.doctorAmount ?? 0) +
          (tx.clinicAmount ?? 0)
      );

      const { error: paidUpdateErr } = await admin
        .from("payroll_records")
        .update({
          paid_doctor_share_amount: newPaidDoctor,
          paid_clinic_share_amount: newPaidClinic,
          paid_total_salary: newPaidTotal,
          paid_at: paidAt,
        })
        .eq("id", activeRecord.id);

      if (paidUpdateErr) {
        return NextResponse.json({ error: paidUpdateErr.message }, { status: 500 });
      }

      const resolvedRecord = {
        ...activeRecord,
        paid_doctor_share_amount: newPaidDoctor,
        paid_clinic_share_amount: newPaidClinic,
        paid_total_salary: newPaidTotal,
      } as PayrollRecord;
      const pendingMode = {
        dailyWage: dailyWage ?? true,
        doctorSharePercentage: doctorSharePct,
      };
      const fullyPaid = assistantIsFullyPaid(resolvedRecord, pendingMode);

      const { error: statusErr } = await admin
        .from("payroll_records")
        .update({ status: fullyPaid ? "paid" : "generated" })
        .eq("id", activeRecord.id);

      if (statusErr) {
        return NextResponse.json({ error: statusErr.message }, { status: 500 });
      }

      await writeAuditLog(admin, {
        clinicId,
        entityType: "payroll",
        entityId: activeRecord.id,
        action: "update",
        changedBy: caller.id,
        actorName: caller.full_name ?? null,
        financialAmount: -Math.abs(tx.clinicAmount ?? 0),
        after: {
          kind: "assistant_entry",
          entry_id: id,
          status: fullyPaid ? "paid" : "generated",
          doctor_id: activeRecord.doctor_id ?? null,
          month_year: entryMonth,
          confirmed_doctor: tx.doctorAmount ?? 0,
          confirmed_clinic: tx.clinicAmount ?? 0,
        },
        note: "تأكيد صرف أجر يومي لمساعد",
      });

      const doctorId = activeRecord.doctor_id?.trim();
      if (doctorId) {
        void import("@/lib/notifications/server")
          .then(({ notifyDoctorAssistantPayrollConfirmed }) =>
            notifyDoctorAssistantPayrollConfirmed({
              clinicId,
              doctorId,
              assistantName: String(
                assistantRow?.full_name_ar ?? activeRecord.assistant_name_ar ?? "مساعد"
              ),
              monthYear: entryMonth,
              doctorDeducted: tx.doctorAmount ?? 0,
              clinicDeducted: tx.clinicAmount ?? 0,
            })
          )
          .catch((err) => {
            console.error("[payroll-confirm] doctor notify failed:", err);
          });
      }

      return NextResponse.json({
        success: true,
        kind: "assistant_entry",
        doctor_id: activeRecord.doctor_id ?? null,
        doctor_deducted: tx.doctorAmount ?? 0,
        clinic_deducted: tx.clinicAmount ?? 0,
        profit_updated: true,
      });
    }

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
        isDailyStaff = synced.isDailyWage ?? false;
      }

      const monthYear = activeSlip.month_year as string;
      if (await isMonthClosed(admin, clinicId, monthYear)) {
        return NextResponse.json(
          { error: "الشهر مُغلق — لا يمكن تأكيد الصرف" },
          { status: 400 }
        );
      }

      if (slipIsFullyPaid(activeSlip, { dailyWage: isDailyStaff })) {
        return NextResponse.json({ success: true, already_paid: true });
      }

      const pending = slipPendingNet(activeSlip, { dailyWage: isDailyStaff });
      if (pending <= 0) {
        return NextResponse.json({ success: true, already_paid: true });
      }

      const resolvedSlipClinicId =
        clinicId || (activeSlip as unknown as { clinic_id?: string }).clinic_id || "";
      const tx = activeSlip.doctor_id
        ? await recordDoctorSalarySlipPaidTransaction(
            admin,
            resolvedSlipClinicId,
            activeSlip,
            pending
          )
        : await recordStaffSlipPaidTransaction(
            admin,
            resolvedSlipClinicId,
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

      let finalSlip = {
        ...activeSlip,
        paid_net_payout: newPaidNet,
      } as SalarySlip;

      if (isDailyStaff) {
        const fullyPaid = slipIsFullyPaid(finalSlip, { dailyWage: true });
        const { error: statusErr } = await admin
          .from("salary_slips")
          .update({ status: fullyPaid ? "paid" : "draft" })
          .eq("id", id);
        if (statusErr) {
          return NextResponse.json({ error: statusErr.message }, { status: 500 });
        }
        finalSlip = { ...finalSlip, status: fullyPaid ? "paid" : "draft" };
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

    const { record: freshRecord, error: recomputeErr, dailyWage } =
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
    const dailyWageResolved = dailyWage ?? false;

    const { data: assistantRow } = await admin
      .from("assistants")
      .select("doctor_share_percentage")
      .eq("id", activeRecord.assistant_id as string)
      .eq("clinic_id", clinicId)
      .maybeSingle();

    const doctorSharePct = Number(
      assistantRow?.doctor_share_percentage ??
        activeRecord.doctor_share_percentage ??
        0
    );
    const pendingMode = {
      dailyWage: dailyWageResolved,
      doctorSharePercentage: doctorSharePct,
    };

    const assistantMonthYear = activeRecord.month_year as string;
    if (await isMonthClosed(admin, clinicId, assistantMonthYear)) {
      return NextResponse.json(
        { error: "الشهر مُغلق — لا يمكن تأكيد الصرف" },
        { status: 400 }
      );
    }

    if (assistantIsFullyPaid(activeRecord, pendingMode)) {
      return NextResponse.json({ success: true, already_paid: true });
    }

    const pendingDoctor = assistantPendingDoctorShare(activeRecord, pendingMode);
    const pendingClinic = assistantPendingClinicShare(activeRecord, pendingMode);

    if (pendingDoctor <= 0 && pendingClinic <= 0) {
      return NextResponse.json({ success: true, already_paid: true });
    }

    const tx = await recordAssistantPayrollPaidTransaction(
      admin,
      clinicId || activeRecord.clinic_id,
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
        (tx.doctorAmount ?? 0) +
        (tx.clinicAmount ?? 0)
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

    const resolvedRecord = {
      ...activeRecord,
      paid_doctor_share_amount: newPaidDoctor,
      paid_clinic_share_amount: newPaidClinic,
      paid_total_salary: newPaidTotal,
    } as PayrollRecord;
    const fullyPaid = assistantIsFullyPaid(resolvedRecord, pendingMode);

    const { error: statusErr } = await admin
      .from("payroll_records")
      .update({ status: fullyPaid ? "paid" : "generated" })
      .eq("id", id);

    if (statusErr) {
      return NextResponse.json({ error: statusErr.message }, { status: 500 });
    }

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
