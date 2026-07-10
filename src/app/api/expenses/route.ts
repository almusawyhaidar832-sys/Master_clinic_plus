import { NextRequest, NextResponse } from "next/server";
import { getApiCallerProfile } from "@/lib/auth/api-session";
import { getAdminClient } from "@/lib/supabase/admin";
import { writeAuditLog } from "@/lib/audit/write-audit-log";
import { recordFinancialTransaction } from "@/lib/services/clinic-profit";
import { insertResilient } from "@/lib/db/resilient-insert";

/**
 * POST /api/expenses
 * تسجيل مصروف + حركة مالية (خصم من ربح العيادة)
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
    const description_ar = String(body.description_ar ?? "").trim();
    const amount = Number(body.amount);
    const expense_date = String(body.expense_date ?? "");
    const category_id = body.category_id ?? null;

    if (!description_ar || !Number.isFinite(amount) || amount <= 0) {
      return NextResponse.json({ error: "الوصف والمبلغ مطلوبان" }, { status: 400 });
    }
    if (!expense_date) {
      return NextResponse.json({ error: "تاريخ المصروف مطلوب" }, { status: 400 });
    }

    const admin = getAdminClient();

    const { data: expense, error: insertErr } = await insertResilient<{ id: string }>(
      admin,
      "expenses",
      {
        clinic_id: clinicId,
        description_ar,
        amount,
        expense_date,
        category_id,
        created_by: caller.id,
      },
      { optionalColumns: ["category_id", "created_by"] }
    );

    if (insertErr || !expense?.id) {
      return NextResponse.json(
        { error: insertErr?.message ?? "تعذر حفظ المصروف" },
        { status: 500 }
      );
    }

    const txResult = await recordFinancialTransaction(admin, {
      clinicId,
      amount: -amount,
      type: "clinic_expense",
      descriptionAr: description_ar,
      transactionDate: expense_date,
      referenceType: "expense",
      referenceId: expense.id,
    });

    if (!txResult.ok) {
      // تراجع عن المصروف كي لا يبقى مصروف بلا حركة مالية مقابلة —
      // فشل واحد موحّد أوضح للمستخدم من حالة "نُصف محفوظ" مربكة.
      await admin.from("expenses").delete().eq("id", expense.id);
      return NextResponse.json(
        { error: `تعذر حفظ المصروف: ${txResult.error}` },
        { status: 500 }
      );
    }

    await writeAuditLog(admin, {
      clinicId,
      entityType: "expense",
      entityId: expense.id,
      action: "create",
      changedBy: caller.id,
      actorName: caller.full_name ?? null,
      financialAmount: -amount,
      after: {
        description_ar,
        amount,
        expense_date,
        category_id,
      },
      note: "تسجيل صرفية عيادة",
    });

    return NextResponse.json({
      success: true,
      expense_id: expense.id,
      profit_updated: true,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "خطأ غير متوقع";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
