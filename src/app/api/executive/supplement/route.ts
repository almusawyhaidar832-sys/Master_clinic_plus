import { NextRequest, NextResponse } from "next/server";
import { getApiCallerProfile } from "@/lib/auth/api-session";
import { getAdminClient } from "@/lib/supabase/admin";
import {
  fetchExecutiveDashboardSupplement,
  fetchNewPatientsInPeriod,
  fetchTopPerformersForPeriod,
  loadOperationsInPeriod,
} from "@/lib/services/executive-snapshot";
import { fetchPeriodCollectionFinancialTotals } from "@/lib/ledger/daily-collections";
import { fetchClinicProfitStatsForPeriod } from "@/lib/services/clinic-stats";
import { normalizeTopPerformersPayload } from "@/lib/services/doctor-performance";
import type { TopPerformersPayload } from "@/lib/services/doctor-performance";

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
    const [supplement, profitStats, collectionFinancials, topPerformers, newPatients] =
      await Promise.all([
        fetchExecutiveDashboardSupplement(admin, clinicId, from, to),
        fetchClinicProfitStatsForPeriod(admin, clinicId, from, to),
        fetchPeriodCollectionFinancialTotals(admin, clinicId, from, to),
        fetchTopPerformersForPeriod(admin, clinicId, from, to),
        fetchNewPatientsInPeriod(admin, clinicId, from, to),
      ]);

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

    return NextResponse.json({
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
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "خطأ غير متوقع";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
