import { NextRequest, NextResponse } from "next/server";
import { getApiCallerProfile } from "@/lib/auth/api-session";
import { isApiStaffRole } from "@/lib/auth/api-portal";
import { getAdminClient } from "@/lib/supabase/admin";
import { ensureDraftInvoiceForOperation } from "@/lib/services/invoice-archive";
import type { SessionInvoiceData } from "@/lib/invoices/session-invoice";

/** POST /api/invoices/draft — مسودة فاتورة مرتبطة بجلسة */
export async function POST(req: NextRequest) {
  try {
    const caller = await getApiCallerProfile(req);
    if (!caller?.clinic_id) {
      return NextResponse.json({ error: "غير مصرح" }, { status: 401 });
    }
    if (!isApiStaffRole(caller.role)) {
      return NextResponse.json({ error: "صلاحيات غير كافية" }, { status: 403 });
    }

    const body = await req.json();
    const operation_id = String(body.operation_id ?? "").trim();
    const snapshot = body.snapshot as SessionInvoiceData | undefined;

    if (!operation_id) {
      return NextResponse.json({ error: "operation_id مطلوب" }, { status: 400 });
    }

    const admin = getAdminClient();
    const result = await ensureDraftInvoiceForOperation(admin, {
      clinicId: caller.clinic_id,
      operationId: operation_id,
      createdBy: caller.id,
      snapshot,
    });

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json({ success: true, invoice_id: result.invoiceId });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "خطأ غير متوقع";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
