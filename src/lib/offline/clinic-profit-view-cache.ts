import type { ClinicProfitStats } from "@/lib/services/clinic-stats";

export type ClinicProfitViewPortal = "admin" | "accountant";

export type ClinicProfitViewCacheQuery = {
  portal: ClinicProfitViewPortal;
  clinicId: string;
  from: string;
  to: string;
};

export type ClinicProfitViewCacheEntry = ClinicProfitViewCacheQuery & {
  stats: ClinicProfitStats;
  outstandingDebts?: number | null;
  pendingCount?: number;
  doctorCount?: number;
  cachedAt: number;
};

const CACHE_PREFIX = "mcp_clinic_profit_view_v1:";
const MAX_ENTRIES = 8;

function entryKey(query: ClinicProfitViewCacheQuery): string {
  return `${CACHE_PREFIX}${query.portal}:${query.clinicId}:${query.from}:${query.to}`;
}

function indexKey(portal: ClinicProfitViewPortal, clinicId: string): string {
  return `${CACHE_PREFIX}index:${portal}:${clinicId}`;
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

function readIndex(portal: ClinicProfitViewPortal, clinicId: string): string[] {
  return readJson<string[]>(indexKey(portal, clinicId)) ?? [];
}

function writeIndex(
  portal: ClinicProfitViewPortal,
  clinicId: string,
  keys: string[]
): void {
  writeJson(indexKey(portal, clinicId), keys.slice(0, MAX_ENTRIES));
}

function pruneIndex(
  portal: ClinicProfitViewPortal,
  clinicId: string,
  keepKey: string
): void {
  const keys = readIndex(portal, clinicId).filter((key) => key !== keepKey);
  keys.unshift(keepKey);
  const dropped = keys.slice(MAX_ENTRIES);
  for (const key of dropped) {
    try {
      localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  }
  writeIndex(portal, clinicId, keys);
}

export function readClinicProfitViewCache(
  query: ClinicProfitViewCacheQuery
): ClinicProfitViewCacheEntry | null {
  const stored = readJson<ClinicProfitViewCacheEntry>(entryKey(query));
  if (!stored?.stats) return null;
  return stored;
}

export function readLatestClinicProfitViewCache(
  portal: ClinicProfitViewPortal,
  clinicId: string
): ClinicProfitViewCacheEntry | null {
  for (const key of readIndex(portal, clinicId)) {
    const stored = readJson<ClinicProfitViewCacheEntry>(key);
    if (stored?.stats) return stored;
  }
  return null;
}

export function writeClinicProfitViewCache(
  entry: Omit<ClinicProfitViewCacheEntry, "cachedAt">
): void {
  const key = entryKey(entry);
  const stored: ClinicProfitViewCacheEntry = {
    ...entry,
    cachedAt: Date.now(),
  };
  if (!writeJson(key, stored)) return;
  pruneIndex(entry.portal, entry.clinicId, key);
}
