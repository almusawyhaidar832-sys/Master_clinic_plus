import { NextRequest, NextResponse } from "next/server";
import { getApiCallerProfile } from "@/lib/auth/api-session";
import { getAdminClient } from "@/lib/supabase/admin";
import { fetchProfitDeductionLedger } from "@/lib/services/profit-deduction-ledger";

/** GET /api/clinic/profit-ledger?from=&to= — تفصيل ما يخصم من ربح العيادة */
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

    const from = req.nextUrl.searchParams.get("from")?.trim() ?? "";
    const to = req.nextUrl.searchParams.get("to")?.trim() ?? "";
    if (!from || !to) {
      return NextResponse.json({ error: "from و to مطلوبان" }, { status: 400 });
    }

    const admin = getAdminClient();
    const ledger = await fetchProfitDeductionLedger(admin, clinicId, from, to);

    return NextResponse.json(ledger);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "خطأ غير متوقع";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
