import { NextRequest, NextResponse } from "next/server";
import { getApiCallerProfile } from "@/lib/auth/api-session";
import { isApiStaffRole } from "@/lib/auth/api-portal";
import { getAdminClient } from "@/lib/supabase/admin";
import { fetchInvoiceHistory } from "@/lib/services/invoice-history-query";
import { syncDoctorExpensesToHistory } from "@/lib/services/invoice-archive";

/** GET /api/invoices/history — السجل التاريخي مع فلاتر */
export async function GET(req: NextRequest) {
  try {
    const caller = await getApiCallerProfile(req);
    if (!caller?.clinic_id) {
      return NextResponse.json({ error: "غير مصرح" }, { status: 401 });
    }
    if (!isApiStaffRole(caller.role)) {
      return NextResponse.json({ error: "صلاحيات غير كافية" }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const doctor_id = searchParams.get("doctor_id");
    const date_from = searchParams.get("date_from");
    const date_to = searchParams.get("date_to");
    const limit = Number(searchParams.get("limit") ?? 50);
    const offset = Number(searchParams.get("offset") ?? 0);

    const admin = getAdminClient();
    try {
      await syncDoctorExpensesToHistory(admin, caller.clinic_id, caller.id);
    } catch {
      /* عمود archived_to_history قد يكون غير موجود بعد — تجاهل */
    }

    const result = await fetchInvoiceHistory(admin, {
      clinicId: caller.clinic_id,
      doctorId: doctor_id,
      dateFrom: date_from,
      dateTo: date_to,
      limit,
      offset,
    });

    return NextResponse.json({
      success: true,
      rows: result.rows,
      total: result.total,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "خطأ غير متوقع";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
