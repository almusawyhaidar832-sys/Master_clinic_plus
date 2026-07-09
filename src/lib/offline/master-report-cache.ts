import type { MasterClinicReport } from "@/lib/services/clinic-reports";

export type MasterReportPortal = "admin" | "accountant";

export type MasterReportCacheEntry = {
  portal: MasterReportPortal;
  monthYear: string;
  report: MasterClinicReport;
  cachedAt: number;
};

const CACHE_PREFIX = "mcp_master_report_v1:";
const MAX_ENTRIES = 6;

function entryKey(portal: MasterReportPortal, monthYear: string): string {
  return `${CACHE_PREFIX}${portal}:${monthYear}`;
}

function indexKey(portal: MasterReportPortal): string {
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

function readIndex(portal: MasterReportPortal): string[] {
  return readJson<string[]>(indexKey(portal)) ?? [];
}

function pruneIndex(portal: MasterReportPortal, keepKey: string): void {
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

export function readMasterReportCache(
  portal: MasterReportPortal,
  monthYear: string
): MasterReportCacheEntry | null {
  return readJson<MasterReportCacheEntry>(entryKey(portal, monthYear));
}

export function readLatestMasterReportCache(
  portal: MasterReportPortal
): MasterReportCacheEntry | null {
  for (const key of readIndex(portal)) {
    const stored = readJson<MasterReportCacheEntry>(key);
    if (stored?.report) return stored;
  }
  return null;
}

export function writeMasterReportCache(
  portal: MasterReportPortal,
  monthYear: string,
  report: MasterClinicReport
): void {
  const key = entryKey(portal, monthYear);
  const entry: MasterReportCacheEntry = {
    portal,
    monthYear,
    report,
    cachedAt: Date.now(),
  };
  if (!writeJson(key, entry)) return;
  pruneIndex(portal, key);
}
