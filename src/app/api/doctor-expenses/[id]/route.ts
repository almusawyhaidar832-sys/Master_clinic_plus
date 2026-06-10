import { NextRequest, NextResponse } from "next/server";
import {
  getApiCallerProfile,
  isApiStaffRole,
} from "@/lib/auth/api-session";
import { getAdminClient } from "@/lib/supabase/admin";
import { hasDoctorExpenseDoctorDeduction } from "@/lib/services/doctor-expense-deduction";

/**
 * DELETE /api/doctor-expenses/[id]
 * حذف فاتورة لم يُطبَّق عليها خصم (تجنب التكرار بعد فشل الحفظ السابق)
 */
export async function DELETE(
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

    const { data: expense } = await admin
      .from("doctor_expenses")
      .select("id")
      .eq("id", expenseId)
      .eq("clinic_id", clinicId)
      .maybeSingle();

    if (!expense) {
      return NextResponse.json({ error: "الفاتورة غير موجودة" }, { status: 404 });
    }

    const deducted = await hasDoctorExpenseDoctorDeduction(
      admin,
      clinicId,
      expenseId
    );
    if (deducted) {
      return NextResponse.json(
        {
          error:
            "لا يمكن حذف فاتورة مُخصَمة — تواصل مع الإدارة إذا كانت مكررة",
        },
        { status: 409 }
      );
    }

    const { error } = await admin
      .from("doctor_expenses")
      .delete()
      .eq("id", expenseId);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "خطأ غير متوقع";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
