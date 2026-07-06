import { NextRequest, NextResponse } from "next/server";
import { getApiCallerProfile } from "@/lib/auth/api-session";
import { isApiStaffRole } from "@/lib/auth/api-portal";
import { getAdminClient } from "@/lib/supabase/admin";
import { fetchDoctorLedgers } from "@/lib/services/clinic-reports";
import { repairDoctorOperationShares } from "@/lib/services/operation-amount-edit";
import { currentMonthYear } from "@/lib/utils";

/** GET /api/admin/doctor-ledgers — حسابات الأطباء للإدارة */
export async function GET(req: NextRequest) {
  try {
    const profile = await getApiCallerProfile(req);
    if (!profile?.clinic_id) {
      return NextResponse.json({ error: "غير مصرح" }, { status: 401 });
    }
    if (!isApiStaffRole(profile.role)) {
      return NextResponse.json({ error: "غير مصرح" }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const monthYear = searchParams.get("month_year") ?? currentMonthYear();

    const admin = getAdminClient();

    await repairDoctorOperationShares(admin, profile.clinic_id);

    const doctors = await fetchDoctorLedgers(
      admin,
      monthYear,
      profile.clinic_id
    );

    return NextResponse.json({ success: true, doctors });
  } catch (err) {
    console.error("[api/admin/doctor-ledgers]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "خطأ" },
      { status: 500 }
    );
  }
}
