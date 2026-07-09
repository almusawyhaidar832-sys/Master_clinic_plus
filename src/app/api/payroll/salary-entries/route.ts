import { NextRequest, NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";
import {
  payrollClinicQueryParam,
  resolvePayrollApiClinic,
} from "@/lib/auth/resolve-payroll-clinic";
import {
  createSalaryEntry,
  isSalaryEntryType,
  listSalaryEntriesForPersonMonth,
} from "@/lib/services/salary-entries-server";
import {
  listConfirmedAssistantDailyEntryIds,
} from "@/lib/services/payroll-financial";
import { validateSalaryEntryReason } from "@/lib/services/salary-entry-reason";

/** GET /api/payroll/salary-entries?staff_id=|assistant_id=&month_year= */
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

    const { clinicId } = resolved;

    const staffId = req.nextUrl.searchParams.get("staff_id")?.trim() ?? "";
    const assistantId = req.nextUrl.searchParams.get("assistant_id")?.trim() ?? "";
    const doctorId = req.nextUrl.searchParams.get("doctor_id")?.trim() ?? "";
    const monthYear = req.nextUrl.searchParams.get("month_year")?.trim() ?? "";
    if ((!staffId && !assistantId && !doctorId) || !monthYear) {
      return NextResponse.json(
        {
          error:
            "staff_id أو assistant_id أو doctor_id مع month_year مطلوبان",
        },
        { status: 400 }
      );
    }

    const admin = getAdminClient();
    const { entries, error } = await listSalaryEntriesForPersonMonth(
      admin,
      clinicId,
      monthYear,
      staffId ? { staffId } : doctorId ? { doctorId } : { assistantId }
    );
    if (error) {
      return NextResponse.json({ error }, { status: 400 });
    }

    let enrichedEntries = entries;
    if (assistantId && entries.length > 0) {
      const dailyIds = entries
        .filter((e) => e.entry_type === "daily_wage")
        .map((e) => e.id);
      const confirmedIds = await listConfirmedAssistantDailyEntryIds(
        admin,
        clinicId,
        dailyIds
      );
      enrichedEntries = entries.map((e) => ({
        ...e,
        payroll_confirmed:
          e.entry_type === "daily_wage" ? confirmedIds.has(e.id) : undefined,
      }));
    }

    return NextResponse.json({ clinic_id: clinicId, entries: enrichedEntries });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "خطأ غير متوقع";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/** POST /api/payroll/salary-entries — تسجيل سلفة / خصم / مكافأة */
export async function POST(req: NextRequest) {
  try {
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

    const { clinicId, caller } = resolved;
    const staffId = String(body.staff_id ?? "").trim();
    const assistantId = String(body.assistant_id ?? "").trim();
    const doctorId = String(body.doctor_id ?? "").trim();
    const monthYear = String(body.month_year ?? "").trim();
    const entryType = String(body.entry_type ?? "").trim();
    const entryDate = String(body.entry_date ?? "").trim();
    const amount = Number(body.amount);
    const baseSalary = Number(body.base_salary ?? 0);
    const notesAr = body.notes_ar != null ? String(body.notes_ar) : null;

    if ((!staffId && !assistantId && !doctorId) || !monthYear || !entryDate) {
      return NextResponse.json(
        { error: "معرّف الموظف و month_year و entry_date مطلوبة" },
        { status: 400 }
      );
    }
    if (!isSalaryEntryType(entryType)) {
      return NextResponse.json({ error: "نوع الحركة غير صالح" }, { status: 400 });
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      return NextResponse.json({ error: "أدخل مبلغاً أكبر من صفر" }, { status: 400 });
    }

    const reasonError = validateSalaryEntryReason(entryType, notesAr);
    if (reasonError) {
      return NextResponse.json({ error: reasonError }, { status: 400 });
    }

    const admin = getAdminClient();
    const result = await createSalaryEntry(admin, {
      clinicId,
      staffId: staffId || undefined,
      assistantId: assistantId || undefined,
      doctorId: doctorId || undefined,
      monthYear,
      baseSalary,
      entryType,
      amount,
      entryDate,
      notesAr,
      createdBy: caller.id,
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
      warning:
        result.notice ??
        (result.error && result.entry ? result.error : undefined),
      profit_updated: Boolean(result.entry),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "خطأ غير متوقع";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
