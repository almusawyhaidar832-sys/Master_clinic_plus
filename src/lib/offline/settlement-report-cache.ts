import type { MonthlySettlementReport } from "@/lib/services/clinic-reports";

export type SettlementReportPortal = "admin" | "accountant";

export type SettlementReportCacheEntry = {
  portal: SettlementReportPortal;
  monthYear: string;
  report: MonthlySettlementReport;
  cachedAt: number;
};

const CACHE_PREFIX = "mcp_settlement_report_v1:";
const MAX_ENTRIES = 6;

function entryKey(portal: SettlementReportPortal, monthYear: string): string {
  return `${CACHE_PREFIX}${portal}:${monthYear}`;
}

function indexKey(portal: SettlementReportPortal): string {
  return `${CACHE_PREFIX}index:${portal}`;
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

function readIndex(portal: SettlementReportPortal): string[] {
  return readJson<string[]>(indexKey(portal)) ?? [];
}

function pruneIndex(portal: SettlementReportPortal, keepKey: string): void {
  const keys = readIndex(portal).filter((key) => key !== keepKey);
  keys.unshift(keepKey);
  const dropped = keys.slice(MAX_ENTRIES);
  for (const key of dropped) {
    try {
      localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  }
  writeJson(indexKey(portal), keys.slice(0, MAX_ENTRIES));
}

export function readSettlementReportCache(
  portal: SettlementReportPortal,
  monthYear: string
): SettlementReportCacheEntry | null {
  return readJson<SettlementReportCacheEntry>(entryKey(portal, monthYear));
}

export function writeSettlementReportCache(
  portal: SettlementReportPortal,
  monthYear: string,
  report: MonthlySettlementReport
): void {
  const key = entryKey(portal, monthYear);
  const entry: SettlementReportCacheEntry = {
    portal,
    monthYear,
    report,
    cachedAt: Date.now(),
  };
  if (!writeJson(key, entry)) return;
  pruneIndex(portal, key);
}
