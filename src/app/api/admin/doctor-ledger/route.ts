import { NextRequest, NextResponse } from "next/server";
import { getApiCallerProfile } from "@/lib/auth/api-session";
import { isApiStaffRole } from "@/lib/auth/api-portal";
import { getAdminClient } from "@/lib/supabase/admin";
import { fetchDoctorLedgerDetail } from "@/lib/services/clinic-reports";
import { repairDoctorOperationShares } from "@/lib/services/operation-amount-edit";
import { currentMonthYear } from "@/lib/utils";

/** GET /api/admin/doctor-ledger — كشف حساب طبيب للإدارة */
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
    const doctorId = searchParams.get("doctor_id")?.trim();
    if (!doctorId) {
      return NextResponse.json({ error: "معرّف الطبيب مطلوب" }, { status: 400 });
    }

    const monthYear = searchParams.get("month_year") ?? currentMonthYear();
    const syncShares = searchParams.get("sync_shares") === "1";

    const admin = getAdminClient();

    if (syncShares) {
      await repairDoctorOperationShares(admin, profile.clinic_id, {
        doctorId,
      });
    }

    const data = await fetchDoctorLedgerDetail(admin, doctorId, monthYear);

    if (!data.doctor || data.doctor.clinic_id !== profile.clinic_id) {
      return NextResponse.json({ error: "غير مصرح" }, { status: 403 });
    }

    return NextResponse.json({ success: true, data });
  } catch (err) {
    console.error("[api/admin/doctor-ledger]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "خطأ" },
      { status: 500 }
    );
  }
}
