export interface DoctorPerformanceRow {
  doctor_id?: string;
  full_name_ar: string;
  /** إجمالي مدفوعات المراجعين في الفترة */
  collected: number;
  /** عدد الجلسات التي دُفع فيها مبلغ */
  payment_count: number;
  revenue: number;
  clinic_share: number;
  doctor_share: number;
  op_count: number;
}

/** تقييم الأداء من 100 — نسبي لأعلى طبيب في الفترة */
export function doctorPerformanceScore(
  collected: number,
  maxCollected: number
): number {
  if (maxCollected <= 0 || collected <= 0) return 0;
  return Math.min(100, Math.round((collected / maxCollected) * 100));
}

export interface InactiveDoctorRow {
  doctor_id?: string;
  full_name_ar: string;
}

export interface TopPerformersPayload {
  top_doctors: DoctorPerformanceRow[];
  top_services: Array<{
    service_name: string;
    count: number;
    revenue: number;
    avg_price: number;
    clinic_margin_pct: number;
  }>;
  top_expenses: Array<{ category: string; total: number; count: number }>;
  inactive_doctors: InactiveDoctorRow[];
}

export interface DoctorPerformanceHighlights {
  topByRevenue: DoctorPerformanceRow | null;
  topByClinicShare: DoctorPerformanceRow | null;
  mostActive: DoctorPerformanceRow | null;
  leastActive: DoctorPerformanceRow | null;
  inactive: InactiveDoctorRow[];
  ranking: DoctorPerformanceRow[];
}

function num(v: unknown): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

export function normalizeTopPerformersPayload(
  raw: unknown
): TopPerformersPayload {
  const data = (raw ?? {}) as Record<string, unknown>;
  const mapDoctor = (row: Record<string, unknown>): DoctorPerformanceRow => {
    const collected = num(row.collected ?? row.revenue);
    return {
      doctor_id: row.doctor_id ? String(row.doctor_id) : undefined,
      full_name_ar: String(row.full_name_ar ?? "طبيب"),
      collected,
      payment_count: num(row.payment_count),
      revenue: num(row.revenue),
      clinic_share: num(row.clinic_share),
      doctor_share: num(row.doctor_share),
      op_count: num(row.op_count),
    };
  };

  return {
    top_doctors: Array.isArray(data.top_doctors)
      ? (data.top_doctors as Record<string, unknown>[]).map(mapDoctor)
      : [],
    top_services: Array.isArray(data.top_services)
      ? (data.top_services as TopPerformersPayload["top_services"])
      : [],
    top_expenses: Array.isArray(data.top_expenses)
      ? (data.top_expenses as TopPerformersPayload["top_expenses"])
      : [],
    inactive_doctors: Array.isArray(data.inactive_doctors)
      ? (data.inactive_doctors as Record<string, unknown>[]).map((row) => ({
          doctor_id: row.doctor_id ? String(row.doctor_id) : undefined,
          full_name_ar: String(row.full_name_ar ?? "طبيب"),
        }))
      : [],
  };
}

export function buildDoctorPerformanceHighlights(
  payload: TopPerformersPayload
): DoctorPerformanceHighlights {
  const ranking = payload.top_doctors;
  if (!ranking.length) {
    return {
      topByRevenue: null,
      topByClinicShare: null,
      mostActive: null,
      leastActive: null,
      inactive: payload.inactive_doctors,
      ranking: [],
    };
  }

  const topByRevenue = [...ranking].sort((a, b) => b.collected - a.collected)[0] ?? null;
  const topByClinicShare = [...ranking].sort(
    (a, b) => b.clinic_share - a.clinic_share
  )[0];
  const mostActive = [...ranking].sort((a, b) => b.op_count - a.op_count)[0];
  const withOps = ranking.filter((d) => d.op_count > 0);
  const leastActive =
    withOps.length > 1
      ? [...withOps].sort((a, b) => a.op_count - b.op_count)[0]
      : null;

  return {
    topByRevenue,
    topByClinicShare,
    mostActive,
    leastActive,
    inactive: payload.inactive_doctors,
    ranking,
  };
}
