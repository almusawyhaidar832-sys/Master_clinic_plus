export type ExecutiveDashboardPeriod = "today" | "week" | "month";

export type ExecutiveDashboardCacheQuery = {
  clinicId: string;
  period: ExecutiveDashboardPeriod;
  from: string;
  to: string;
};

export type CachedExecutiveSnapshot = {
  revenue: number;
  collected: number;
  debt: number;
  debtors_count: number;
  doctor_shares: number;
  clinic_shares: number;
  materials_cost: number;
  expenses: number;
  salaries_paid: number;
  salaries_deducted_from_profit?: number;
  review_fees: number;
  balance_topups?: number;
  withdrawals_paid: number;
  net_profit: number;
  operation_count: number;
  patient_count: number;
  new_patients: number;
  prev_revenue: number;
  prev_expenses: number;
  revenue_growth: number | null;
  period_from: string;
  period_to: string;
};

export type CachedTopPerformers = {
  top_doctors: Array<{
    full_name_ar: string;
    collected: number;
    payment_count: number;
    revenue: number;
    clinic_share?: number;
    doctor_share: number;
    op_count: number;
  }>;
  top_services: Array<{
    service_name: string;
    count: number;
    revenue: number;
    avg_price: number;
    clinic_margin_pct: number;
  }>;
  top_expenses: Array<{ category: string; total: number; count: number }>;
  inactive_doctors?: Array<{ full_name_ar: string; doctor_id?: string }>;
};

export type ExecutiveDashboardCacheEntry = {
  query: ExecutiveDashboardCacheQuery;
  snap: CachedExecutiveSnapshot;
  top: CachedTopPerformers | null;
  cachedAt: number;
};

const CACHE_PREFIX = "mcp_executive_dashboard_v1:";
const MAX_ENTRIES = 6;

function entryKey(query: ExecutiveDashboardCacheQuery): string {
  return `${CACHE_PREFIX}${query.clinicId}:${query.period}:${query.from}:${query.to}`;
}

function indexKey(clinicId: string): string {
  return `${CACHE_PREFIX}index:${clinicId}`;
}

function readJson<T>(key: string): T | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown): boolean {
  if (typeof window === "undefined") return false;
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

function readIndex(clinicId: string): string[] {
  return readJson<string[]>(indexKey(clinicId)) ?? [];
}

function pruneIndex(clinicId: string, keepKey: string): void {
  const keys = readIndex(clinicId).filter((key) => key !== keepKey);
  keys.unshift(keepKey);
  const dropped = keys.slice(MAX_ENTRIES);
  for (const key of dropped) {
    try {
      localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  }
  writeJson(indexKey(clinicId), keys.slice(0, MAX_ENTRIES));
}

export function readExecutiveDashboardCache(
  query: ExecutiveDashboardCacheQuery
): ExecutiveDashboardCacheEntry | null {
  const exact = readJson<ExecutiveDashboardCacheEntry>(entryKey(query));
  if (exact?.snap) return exact;

  for (const key of readIndex(query.clinicId)) {
    const stored = readJson<ExecutiveDashboardCacheEntry>(key);
    if (stored?.snap && stored.query.period === query.period) return stored;
  }
  return null;
}

export function writeExecutiveDashboardCache(
  query: ExecutiveDashboardCacheQuery,
  data: { snap: CachedExecutiveSnapshot; top: CachedTopPerformers | null }
): void {
  const key = entryKey(query);
  const entry: ExecutiveDashboardCacheEntry = {
    query,
    snap: data.snap,
    top: data.top,
    cachedAt: Date.now(),
  };
  if (!writeJson(key, entry)) return;
  pruneIndex(query.clinicId, key);
}
