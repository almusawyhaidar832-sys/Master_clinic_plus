import { NextRequest, NextResponse } from "next/server";
import { resolveDoctorFromApiRequest } from "@/lib/auth/resolve-doctor-api";
import { syncDoctorExpensesToHistory } from "@/lib/services/invoice-archive";
import { fetchDoctorFinancialReport } from "@/lib/services/doctor-financial-ledger";
import { fetchDoctorWalletStats } from "@/lib/services/doctor-wallet";

/** GET /api/doctor/financial-ledger/report */
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
    const date_from = searchParams.get("date_from");
    const date_to = searchParams.get("date_to");

    try {
      await syncDoctorExpensesToHistory(
        ctx.admin,
        ctx.clinicId,
        ctx.profileId
      );
    } catch {
      /* ignore */
    }

    const wallet = await fetchDoctorWalletStats(ctx.admin, ctx.doctorId);
    const report = await fetchDoctorFinancialReport(
      ctx.admin,
      ctx.doctorId,
      ctx.clinicId,
      { dateFrom: date_from, dateTo: date_to },
      {
        totalEarnings: wallet.totalEarnings,
        availableBalance: wallet.availableBalance,
      }
    );

    return NextResponse.json({ success: true, report });
  } catch (err) {
    console.error("[api/doctor/financial-ledger/report]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "خطأ" },
      { status: 500 }
    );
  }
}
