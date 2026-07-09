import { NextRequest, NextResponse } from "next/server";
import { getApiCallerProfile } from "@/lib/auth/api-session";
import { isApiStaffRole } from "@/lib/auth/api-portal";
import { getAdminClient } from "@/lib/supabase/admin";
import {
  fetchDailyCollections,
  type CollectionStatusFilter,
} from "@/lib/ledger/daily-collections";
import { repairDoctorOperationShares } from "@/lib/services/operation-amount-edit";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate",
};

const VALID_FILTERS: CollectionStatusFilter[] = [
  "all",
  "paid",
  "unpaid",
  "at_accountant",
  "debtors",
];

/** GET /api/admin/daily-collections — كشف مالي للإدارة/المحاسب (نفس منطق الطبيب) */
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
    const dateFrom = searchParams.get("date_from") ?? undefined;
    const dateTo = searchParams.get("date_to") ?? undefined;
    const doctorId = searchParams.get("doctor_id")?.trim() || undefined;
    const rawFilter = searchParams.get("status_filter") ?? "all";
    const statusFilter = VALID_FILTERS.includes(
      rawFilter as CollectionStatusFilter
    )
      ? (rawFilter as CollectionStatusFilter)
      : "all";
    const syncShares = searchParams.get("sync_shares") === "1";

    const admin = getAdminClient();
    const effectiveTo = dateTo ?? dateFrom;

    if (syncShares) {
      await repairDoctorOperationShares(admin, profile.clinic_id, {
        doctorId,
        ...(dateFrom && effectiveTo ? { dateFrom, dateTo: effectiveTo } : {}),
      });
    }

    const result = await fetchDailyCollections(admin, profile.clinic_id, {
      dateFrom,
      dateTo,
      doctorId,
      statusFilter,
    });

    return NextResponse.json({ success: true, result }, { headers: NO_STORE_HEADERS });
  } catch (err) {
    console.error("[api/admin/daily-collections]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "خطأ" },
      { status: 500 }
    );
  }
}
