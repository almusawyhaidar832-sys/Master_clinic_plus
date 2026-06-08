import { NextRequest, NextResponse } from "next/server";
import { getApiCallerProfile } from "@/lib/auth/api-session";
import { getAdminClient } from "@/lib/supabase/admin";
import { doctorShareFromExpense } from "@/lib/services/assistant-payroll";
import { recordFinancialTransaction } from "@/lib/services/clinic-profit";

/**
 * POST /api/doctor-expenses
 * تسجيل فاتورة صرفية طبيب + حركات مالية (خصم من رصيد الطبيب + حصة العيادة)
 */
export async function POST(req: NextRequest) {
  try {
    const caller = await getApiCallerProfile(req);
    if (!caller) {
      return NextResponse.json({ error: "يجب تسجيل الدخول أولاً" }, { status: 401 });
    }

    if (!["accountant", "super_admin", "admin"].includes(caller.role)) {
      return NextResponse.json({ error: "صلاحيات غير كافية" }, { status: 403 });
    }

    const clinicId = caller.clinic_id;
    if (!clinicId) {
      return NextResponse.json({ error: "حسابك غير مربوط بعيادة" }, { status: 400 });
    }

    const body = await req.json();
    const doctorId = String(body.doctor_id ?? "");
    const amount = Number(body.amount);
    const percentageSplit = Number(body.percentage_split ?? 50);
    const descriptionAr = String(body.description_ar ?? "").trim() || null;
    const expenseDate =
      String(body.expense_date ?? "") || new Date().toISOString().slice(0, 10);

    if (!doctorId) {
      return NextResponse.json({ error: "الطبيب مطلوب" }, { status: 400 });
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      return NextResponse.json({ error: "المبلغ غير صالح" }, { status: 400 });
    }
    if (
      !Number.isFinite(percentageSplit) ||
      percentageSplit < 0 ||
      percentageSplit > 100
    ) {
      return NextResponse.json({ error: "نسبة الطبيب بين 0 و 100" }, { status: 400 });
    }

    const admin = getAdminClient();

    const { data: doctor } = await admin
      .from("doctors")
      .select("id, full_name_ar")
      .eq("id", doctorId)
      .eq("clinic_id", clinicId)
      .maybeSingle();

    if (!doctor) {
      return NextResponse.json({ error: "الطبيب غير موجود في العيادة" }, { status: 404 });
    }

    const doctorShare = doctorShareFromExpense(amount, percentageSplit);
    const clinicShare = Math.round((amount - doctorShare) * 100) / 100;

    const { data: expense, error: insertErr } = await admin
      .from("doctor_expenses")
      .insert({
        clinic_id: clinicId,
        doctor_id: doctorId,
        amount,
        percentage_split: percentageSplit,
        description_ar: descriptionAr,
        expense_date: expenseDate,
        invoice_storage_path: body.invoice_storage_path ?? null,
        invoice_file_name: body.invoice_file_name ?? null,
        invoice_mime_type: body.invoice_mime_type ?? null,
        created_by: caller.id,
      })
      .select("id")
      .single();

    if (insertErr || !expense?.id) {
      return NextResponse.json(
        { error: insertErr?.message ?? "تعذر حفظ الفاتورة" },
        { status: 500 }
      );
    }

    const label = descriptionAr ?? "صرفية طبيب";
    const doctorName = doctor.full_name_ar as string;

    if (doctorShare > 0) {
      const doctorTx = await recordFinancialTransaction(admin, {
        clinicId,
        amount: -doctorShare,
        type: "doctor_expense_doctor",
        descriptionAr: `صرفية — ${doctorName}: ${label}`,
        transactionDate: expenseDate,
        doctorId,
        referenceType: "doctor_expense_doctor",
        referenceId: expense.id,
      });
      if (!doctorTx.ok) {
        return NextResponse.json(
          {
            error: `حُفظت الفاتورة لكن فشل خصم الطبيب: ${doctorTx.error}`,
            expense_id: expense.id,
          },
          { status: 500 }
        );
      }
    }

    if (clinicShare > 0) {
      await recordFinancialTransaction(admin, {
        clinicId,
        amount: -clinicShare,
        type: "doctor_expense_clinic",
        descriptionAr: `حصة عيادة — صرفية ${doctorName}: ${label}`,
        transactionDate: expenseDate,
        referenceType: "doctor_expense_clinic",
        referenceId: expense.id,
      });
    }

    return NextResponse.json({
      success: true,
      expense_id: expense.id,
      doctor_share: doctorShare,
      clinic_share: clinicShare,
      profit_updated: true,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "خطأ غير متوقع";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
