import { NextRequest, NextResponse } from "next/server";
import {
  getApiCallerProfile,
  isApiStaffRole,
} from "@/lib/auth/api-session";
import { getAdminClient } from "@/lib/supabase/admin";
import {
  applyDoctorExpenseFinancialDeductions,
  hasDoctorExpenseDoctorDeduction,
} from "@/lib/services/doctor-expense-deduction";

/**
 * POST /api/doctor-expenses/[id]/apply-deduction
 * تطبيق الخصم لفاتورة محفوظة سابقاً بدون حركة مالية (بعد فشل id في transactions)
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const caller = await getApiCallerProfile(req);
    if (!caller) {
      return NextResponse.json({ error: "يجب تسجيل الدخول أولاً" }, { status: 401 });
    }

    if (!isApiStaffRole(String(caller.role ?? ""))) {
      return NextResponse.json({ error: "صلاحيات غير كافية" }, { status: 403 });
    }

    const clinicId = caller.clinic_id;
    if (!clinicId) {
      return NextResponse.json({ error: "حسابك غير مربوط بعيادة" }, { status: 400 });
    }

    const { id: expenseId } = await params;
    const admin = getAdminClient();

    const { data: expense, error: loadErr } = await admin
      .from("doctor_expenses")
      .select(
        "id, clinic_id, doctor_id, amount, percentage_split, description_ar, expense_date, doctor:doctors(full_name_ar)"
      )
      .eq("id", expenseId)
      .eq("clinic_id", clinicId)
      .maybeSingle();

    if (loadErr || !expense) {
      return NextResponse.json({ error: "الفاتورة غير موجودة" }, { status: 404 });
    }

    const alreadyDeducted = await hasDoctorExpenseDoctorDeduction(
      admin,
      clinicId,
      expenseId
    );
    if (alreadyDeducted) {
      return NextResponse.json({
        success: true,
        already_applied: true,
        message: "الخصم مُطبَّق مسبقاً على هذه الفاتورة",
      });
    }

    const doctorJoin = expense.doctor as { full_name_ar?: string } | null;
    const doctorName = doctorJoin?.full_name_ar ?? "طبيب";

    const deduction = await applyDoctorExpenseFinancialDeductions(admin, {
      clinicId,
      expenseId,
      doctorId: expense.doctor_id as string,
      doctorName,
      amount: Number(expense.amount),
      percentageSplit: Number(expense.percentage_split ?? 50),
      descriptionAr: (expense.description_ar as string | null) ?? null,
      expenseDate: expense.expense_date as string,
    });

    if (!deduction.ok) {
      return NextResponse.json(
        { error: deduction.error ?? "تعذر تطبيق الخصم" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      doctor_share: deduction.doctorShare,
      clinic_share: deduction.clinicShare,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "خطأ غير متوقع";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
