import { NextRequest, NextResponse } from "next/server";
import { resolveDoctorFromApiRequest } from "@/lib/auth/resolve-doctor-api";
import { syncDoctorExpensesToHistory } from "@/lib/services/invoice-archive";
import { repairDoctorOperationShares } from "@/lib/services/operation-amount-edit";
import {
  fetchDoctorLedgerFinancialOps,
  fetchDoctorLedgerInvoices,
  fetchDoctorLedgerPatients,
} from "@/lib/services/doctor-financial-ledger";

/** GET /api/doctor/financial-ledger?section=invoices|patients|operations */
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
    const section = searchParams.get("section") ?? "invoices";
    const date_from = searchParams.get("date_from");
    const date_to = searchParams.get("date_to");
    const limit = Number(searchParams.get("limit") ?? 50);
    const offset = Number(searchParams.get("offset") ?? 0);

    const dateFilters = {
      dateFrom: date_from,
      dateTo: date_to,
      limit,
      offset,
    };

    await repairDoctorOperationShares(ctx.admin, ctx.clinicId, {
      doctorId: ctx.doctorId,
      dateFrom: date_from ?? undefined,
      dateTo: date_to ?? undefined,
    });

    try {
      await syncDoctorExpensesToHistory(
        ctx.admin,
        ctx.clinicId,
        ctx.profileId
      );
    } catch {
      /* archived_to_history قد يكون غير موجود */
    }

    if (section === "patients") {
      const result = await fetchDoctorLedgerPatients(
        ctx.admin,
        ctx.doctorId,
        ctx.clinicId,
        dateFilters
      );
      return NextResponse.json({ success: true, section, ...result });
    }

    if (section === "operations") {
      const result = await fetchDoctorLedgerFinancialOps(
        ctx.admin,
        ctx.doctorId,
        ctx.clinicId,
        dateFilters
      );
      return NextResponse.json({ success: true, section, ...result });
    }

    const result = await fetchDoctorLedgerInvoices(
      ctx.admin,
      ctx.doctorId,
      ctx.clinicId,
      dateFilters
    );
    return NextResponse.json({ success: true, section: "invoices", ...result });
  } catch (err) {
    console.error("[api/doctor/financial-ledger]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "خطأ" },
      { status: 500 }
    );
  }
}
