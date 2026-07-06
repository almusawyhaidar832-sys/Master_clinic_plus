import { NextRequest, NextResponse } from "next/server";
import { getApiCallerProfile } from "@/lib/auth/api-session";
import { getAdminClient } from "@/lib/supabase/admin";
import {
  fetchExecutiveDashboardSupplement,
  fetchNewPatientsInPeriod,
  fetchTopPerformersForPeriod,
  loadOperationsInPeriod,
  summarizePeriodOperationFinancials,
} from "@/lib/services/executive-snapshot";
import { fetchClinicProfitStatsForPeriod } from "@/lib/services/clinic-stats";
import { normalizeTopPerformersPayload } from "@/lib/services/doctor-performance";

/** GET /api/executive/supplement?from=&to= — بيانات الرواتب + ربح مُحاذٍ للتقرير */
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
    const ops = await loadOperationsInPeriod(admin, clinicId, from, to);
    const [supplement, profitStats, opFinancials, topPerformers, newPatients] =
      await Promise.all([
        fetchExecutiveDashboardSupplement(admin, clinicId, from, to),
        fetchClinicProfitStatsForPeriod(admin, clinicId, from, to),
        summarizePeriodOperationFinancials(admin, ops),
        fetchTopPerformersForPeriod(admin, clinicId, from, to),
        fetchNewPatientsInPeriod(admin, clinicId, from, to),
      ]);

    const reviewFees =
      profitStats.breakdown.find((b) => b.label === "كشفيات المراجعين")
        ?.amount ?? 0;

    const revenue = opFinancials.revenue;
    const patientCount = new Set(
      ops.map((op) => op.patient_id).filter(Boolean)
    ).size;

    return NextResponse.json({
      ...supplement,
      topPerformers: normalizeTopPerformersPayload(topPerformers),
      reportAligned: {
        netProfit: profitStats.netProfit,
        clinicShareTotal: opFinancials.clinicShareTotal,
        totalExpenses: profitStats.totalExpenses,
        reviewFees,
        salariesDeducted: profitStats.totalSalariesPaid,
        doctorShareTotal: opFinancials.doctorShareTotal,
        revenue,
        collected: opFinancials.collected,
        operationCount: ops.length,
        patientCount,
        newPatients,
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "خطأ غير متوقع";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
