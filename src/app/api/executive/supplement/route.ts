import { NextRequest, NextResponse } from "next/server";
import { getApiCallerProfile, isApiStaffRole } from "@/lib/auth/api-session";
import { resolveStaffApiClinicId } from "@/lib/auth/resolve-staff-clinic";
import { getAdminClient } from "@/lib/supabase/admin";
import {
  fetchExecutiveDashboardSupplement,
  fetchNewPatientsInPeriod,
  fetchTopPerformersForPeriod,
  loadOperationsInPeriod,
} from "@/lib/services/executive-snapshot";
import { fetchPeriodCollectionFinancialTotals } from "@/lib/ledger/daily-collections";
import {
  applyClinicTopUpToProfitStats,
  fetchClinicProfitStatsForPeriod,
} from "@/lib/services/clinic-stats";
import { fetchClinicBalanceTopupsForPeriod } from "@/lib/services/balance-topup";
import { normalizeTopPerformersPayload } from "@/lib/services/doctor-performance";
import type { TopPerformersPayload } from "@/lib/services/doctor-performance";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate",
};

function alignTopPerformersWithCollections(
  payload: TopPerformersPayload,
  byDoctor: Array<{
    doctorId: string;
    doctorName: string;
    collected: number;
    doctorShare: number;
    clinicShare: number;
  }>
): TopPerformersPayload {
  if (!byDoctor.length) return payload;

  const byId = new Map(byDoctor.map((d) => [d.doctorId, d]));
  const mergedDoctors = byDoctor
    .filter((d) => d.collected > 0 || d.doctorShare > 0)
    .map((d) => ({
      doctor_id: d.doctorId,
      full_name_ar: d.doctorName,
      collected: d.collected,
      payment_count: 0,
      revenue: d.collected,
      clinic_share: d.clinicShare,
      doctor_share: d.doctorShare,
      op_count: 0,
    }))
    .sort((a, b) => b.collected - a.collected || b.doctor_share - a.doctor_share);

  if (mergedDoctors.length === 0) return payload;

  const enriched = payload.top_doctors.map((row) => {
    const id = row.doctor_id ?? "";
    const fromCollections = id ? byId.get(id) : undefined;
    if (!fromCollections) return row;
    return {
      ...row,
      collected: fromCollections.collected,
      doctor_share: fromCollections.doctorShare,
      clinic_share: fromCollections.clinicShare,
      revenue: Math.max(row.revenue, fromCollections.collected),
    };
  });

  const seen = new Set(enriched.map((d) => d.doctor_id ?? d.full_name_ar));
  for (const row of mergedDoctors) {
    const key = row.doctor_id ?? row.full_name_ar;
    if (!seen.has(key)) {
      enriched.push(row);
      seen.add(key);
    }
  }

  enriched.sort(
    (a, b) =>
      b.collected - a.collected ||
      b.doctor_share - a.doctor_share
  );

  return {
    ...payload,
    top_doctors: enriched,
  };
}

/** GET /api/executive/supplement?from=&to= — بيانات الرواتب + ربح مُحاذٍ للتقرير */
export async function GET(req: NextRequest) {
  try {
    const caller = await getApiCallerProfile(req);
    if (!caller) {
      return NextResponse.json({ error: "يجب تسجيل الدخول أولاً" }, { status: 401 });
    }
    if (!isApiStaffRole(caller.role)) {
      return NextResponse.json({ error: "صلاحيات غير كافية" }, { status: 403 });
    }

    const clinicId = await resolveStaffApiClinicId(req, caller);
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
    const ops = await loadOperationsInPeriod(admin, clinicId, from, to);
    const [supplement, profitStatsRaw, collectionFinancials, topPerformers, newPatients] =
      await Promise.all([
        fetchExecutiveDashboardSupplement(admin, clinicId, from, to),
        fetchClinicProfitStatsForPeriod(admin, clinicId, from, to),
        fetchPeriodCollectionFinancialTotals(admin, clinicId, from, to),
        fetchTopPerformersForPeriod(admin, clinicId, from, to),
        fetchNewPatientsInPeriod(admin, clinicId, from, to),
      ]);

    let profitStats = profitStatsRaw;
    const topupsDirect = await fetchClinicBalanceTopupsForPeriod(
      admin,
      clinicId,
      from,
      to
    );
    if (topupsDirect > profitStats.balanceTopupsTotal + 0.01) {
      const delta =
        Math.round((topupsDirect - profitStats.balanceTopupsTotal) * 100) / 100;
      profitStats = applyClinicTopUpToProfitStats(profitStats, delta);
    }

    const reviewFees = profitStats.reviewFeesTotal;

    const revenue = Math.round(
      ops.reduce((s, op) => s + Number(op.total_amount ?? 0), 0) * 100
    ) / 100;
    const patientCount = new Set(
      ops.map((op) => op.patient_id).filter(Boolean)
    ).size;

    const topPayload = alignTopPerformersWithCollections(
      normalizeTopPerformersPayload(topPerformers),
      collectionFinancials.byDoctor
    );

    return NextResponse.json(
      {
        ...supplement,
        topPerformers: topPayload,
        reportAligned: {
          netProfit: profitStats.netProfit,
          clinicShareTotal: collectionFinancials.clinicShareTotal,
          totalExpenses: profitStats.totalExpenses,
          reviewFees,
          balanceTopups: profitStats.balanceTopupsTotal,
          salariesDeducted: profitStats.totalSalariesPaid,
          doctorShareTotal: collectionFinancials.doctorShareTotal,
          revenue,
          collected: collectionFinancials.collected,
          operationCount: ops.length,
          patientCount,
          newPatients,
          doctorEarningsByDoctor: collectionFinancials.byDoctor,
        },
      },
      { headers: NO_STORE_HEADERS }
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "خطأ غير متوقع";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
