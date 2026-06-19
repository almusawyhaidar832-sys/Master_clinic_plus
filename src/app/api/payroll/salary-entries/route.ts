import { NextRequest, NextResponse } from "next/server";
import { getApiCallerProfile } from "@/lib/auth/api-session";
import { getAdminClient } from "@/lib/supabase/admin";
import {
  createSalaryEntry,
  isSalaryEntryType,
  listSalaryEntriesForPersonMonth,
} from "@/lib/services/salary-entries-server";
import { validateSalaryEntryReason } from "@/lib/services/salary-entry-reason";

/** GET /api/payroll/salary-entries?staff_id=|assistant_id=&month_year= */
export async function GET(req: NextRequest) {
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
    return NextResponse.json({ entries });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "خطأ غير متوقع";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/** POST /api/payroll/salary-entries — تسجيل سلفة / خصم / مكافأة */
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
