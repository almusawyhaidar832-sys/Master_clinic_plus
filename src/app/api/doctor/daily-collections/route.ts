import { NextRequest, NextResponse } from "next/server";
import { resolveDoctorFromApiRequest } from "@/lib/auth/resolve-doctor-api";
import {
  fetchDailyCollections,
  type CollectionStatusFilter,
} from "@/lib/ledger/daily-collections";
import { repairDoctorOperationShares } from "@/lib/services/operation-amount-edit";

const VALID_FILTERS: CollectionStatusFilter[] = [
  "all",
  "paid",
  "unpaid",
  "at_accountant",
  "debtors",
];

/** GET /api/doctor/daily-collections — كشف مالي للطبيب الحالي فقط */
export async function GET(req: NextRequest) {
  try {
    const resolved = await resolveDoctorFromApiRequest(req);
    if (!resolved.ok) {
      return NextResponse.json(
        { error: resolved.error },
        { status: resolved.status }
      );
    }

    const { ctx } = resolved;
    const { searchParams } = new URL(req.url);
    const dateFrom = searchParams.get("date_from") ?? undefined;
    const dateTo = searchParams.get("date_to") ?? undefined;
    const rawFilter = searchParams.get("status_filter") ?? "all";
    const statusFilter = VALID_FILTERS.includes(
      rawFilter as CollectionStatusFilter
    )
      ? (rawFilter as CollectionStatusFilter)
      : "all";
    const syncShares = searchParams.get("sync_shares") === "1";
    const effectiveTo = dateTo ?? dateFrom;

    if (dateFrom && effectiveTo) {
      await repairDoctorOperationShares(ctx.admin, ctx.clinicId, {
        doctorId: ctx.doctorId,
        dateFrom,
        dateTo: effectiveTo,
      });
    }

    if (syncShares) {
      await repairDoctorOperationShares(ctx.admin, ctx.clinicId, {
        doctorId: ctx.doctorId,
      });
    }

    const result = await fetchDailyCollections(ctx.admin, ctx.clinicId, {
      dateFrom,
      dateTo,
      doctorId: ctx.doctorId,
      statusFilter,
    });

    return NextResponse.json({ success: true, result });
  } catch (err) {
    console.error("[api/doctor/daily-collections]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "خطأ" },
      { status: 500 }
    );
  }
}
