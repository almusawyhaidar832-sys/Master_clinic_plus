import { NextRequest, NextResponse } from "next/server";
import {
  getApiCallerProfile,
  isApiStaffRole,
} from "@/lib/auth/api-session";
import { resolveDoctorFromApiRequest } from "@/lib/auth/resolve-doctor-api";
import { getAdminClient } from "@/lib/supabase/admin";
import {
  createDoctorExpenseInvoiceSignedUrl,
  fetchDoctorExpenseAttachment,
} from "@/lib/services/doctor-expense-invoice-file";

/** GET /api/doctor-expenses/[id]/invoice-url — رابط مؤقت لصورة/PDF فاتورة الصرف */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: expenseId } = await params;
    const admin = getAdminClient();

    const { data: expense } = await admin
      .from("doctor_expenses")
      .select("id, clinic_id, doctor_id")
      .eq("id", expenseId)
      .maybeSingle();

    if (!expense) {
      return NextResponse.json({ error: "الفاتورة غير موجودة" }, { status: 404 });
    }

    const caller = await getApiCallerProfile(req);
    if (!caller) {
      return NextResponse.json({ error: "يجب تسجيل الدخول أولاً" }, { status: 401 });
    }

    const role = String(caller.role ?? "").toLowerCase();
    let authorized = false;

    if (isApiStaffRole(role) && caller.clinic_id === expense.clinic_id) {
      authorized = true;
    }

    if (!authorized && role === "doctor") {
      const resolved = await resolveDoctorFromApiRequest(req);
      if (
        resolved.ok &&
        resolved.ctx.clinicId === expense.clinic_id &&
        resolved.ctx.doctorId === expense.doctor_id
      ) {
        authorized = true;
      }
    }

    if (!authorized) {
      return NextResponse.json({ error: "صلاحيات غير كافية" }, { status: 403 });
    }

    const attachment = await fetchDoctorExpenseAttachment(admin, expenseId);
    if (!attachment) {
      return NextResponse.json({ error: "لا توجد صورة مرفقة" }, { status: 404 });
    }

    const url = await createDoctorExpenseInvoiceSignedUrl(
      admin,
      attachment.storagePath
    );
    if (!url) {
      return NextResponse.json({ error: "تعذر فتح المرفق" }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      url,
      file_name: attachment.fileName,
      mime_type: attachment.mimeType,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "خطأ غير متوقع";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
