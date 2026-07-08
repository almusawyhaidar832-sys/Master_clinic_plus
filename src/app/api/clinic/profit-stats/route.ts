import { NextRequest, NextResponse } from "next/server";
import {
  getApiCallerProfile,
  isApiStaffRole,
} from "@/lib/auth/api-session";
import { verifyStaffClinicAccess, resolveStaffApiClinicId } from "@/lib/auth/resolve-staff-clinic";
import { getAdminClient } from "@/lib/supabase/admin";
import {
  applyClinicTopUpToProfitStats,
  fetchClinicProfitStatsForPeriod,
} from "@/lib/services/clinic-stats";
import { fetchClinicBalanceTopupsForPeriod } from "@/lib/services/balance-topup";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate",
};

/** GET /api/clinic/profit-stats?from=&to= — أرباح الفترة (مصدر موحّد للإدارة والمحاسب) */
export async function GET(req: NextRequest) {
  try {
    const caller = await getApiCallerProfile(req);
    if (!caller) {
      return NextResponse.json({ error: "يجب تسجيل الدخول أولاً" }, { status: 401 });
    }
    if (!isApiStaffRole(caller.role)) {
      return NextResponse.json({ error: "صلاحيات غير كافية" }, { status: 403 });
    }

    const fromQuery = req.nextUrl.searchParams.get("clinic_id")?.trim() || null;
    let clinicId: string | null = null;

    if (fromQuery && (await verifyStaffClinicAccess(req, caller, fromQuery))) {
      clinicId = fromQuery;
    } else {
      clinicId = await resolveStaffApiClinicId(req, caller);
    }

    if (!clinicId) {
      return NextResponse.json(
        { error: "حسابك غير مربوط بعيادة أو العيادة المطلوبة غير مصرح بها" },
        { status: 400 }
      );
    }

    const from = req.nextUrl.searchParams.get("from")?.trim() ?? "";
    const to = req.nextUrl.searchParams.get("to")?.trim() ?? "";
    if (!from || !to) {
      return NextResponse.json({ error: "from و to مطلوبان" }, { status: 400 });
    }

    const admin = getAdminClient();
    let stats = await fetchClinicProfitStatsForPeriod(admin, clinicId, from, to);

    const topupsDirect = await fetchClinicBalanceTopupsForPeriod(
      admin,
      clinicId,
      from,
      to
    );
    if (topupsDirect > stats.balanceTopupsTotal + 0.01) {
      const delta = Math.round((topupsDirect - stats.balanceTopupsTotal) * 100) / 100;
      stats = applyClinicTopUpToProfitStats(stats, delta);
    }

    return NextResponse.json(stats, { headers: NO_STORE_HEADERS });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "خطأ غير متوقع";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
