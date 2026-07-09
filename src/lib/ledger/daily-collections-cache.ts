import type { DailyCollectionsResult } from "@/lib/ledger/daily-collections";
import { isBrowserOffline } from "@/lib/offline/network";
import { reconcileDailyCollectionsResult } from "@/lib/services/doctor-wallet-pending";

export type DailyCollectionsPortal = "admin" | "accountant" | "doctor";

export type DailyCollectionsCacheScope = {
  portal: DailyCollectionsPortal;
  clinicId: string;
  doctorId?: string | null;
};

export type DailyCollectionsCacheQuery = DailyCollectionsCacheScope & {
  dateFrom: string;
  dateTo: string;
};

export type DailyCollectionsCacheSource = "network" | "cache" | "none";

export type DailyCollectionsCacheEntry = {
  query: DailyCollectionsCacheQuery;
  result: DailyCollectionsResult;
  cachedAt: number;
};

export type DailyCollectionsLoadResult = {
  result: DailyCollectionsResult | null;
  source: DailyCollectionsCacheSource;
  cachedAt: number | null;
  offline: boolean;
};

const CACHE_PREFIX = "mcp_daily_collections_v1:";
const MAX_ENTRIES_PER_SCOPE = 12;

function scopeSuffix(scope: DailyCollectionsCacheScope): string {
  const doctor = scope.doctorId?.trim() || "all";
  return `${scope.portal}:${scope.clinicId}:${doctor}`;
}

function entryStorageKey(query: DailyCollectionsCacheQuery): string {
  return `${CACHE_PREFIX}${scopeSuffix(query)}:${query.dateFrom}:${query.dateTo}`;
}

function indexStorageKey(scope: DailyCollectionsCacheScope): string {
  return `${CACHE_PREFIX}index:${scopeSuffix(scope)}`;
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

function readIndex(scope: DailyCollectionsCacheScope): string[] {
  return readJson<string[]>(indexStorageKey(scope)) ?? [];
}

function writeIndex(scope: DailyCollectionsCacheScope, keys: string[]): void {
  writeJson(indexStorageKey(scope), keys.slice(0, MAX_ENTRIES_PER_SCOPE));
}

function pruneScopeIndex(scope: DailyCollectionsCacheScope, keepKey: string): void {
  const keys = readIndex(scope).filter((key) => key !== keepKey);
  keys.unshift(keepKey);
  const dropped = keys.slice(MAX_ENTRIES_PER_SCOPE);
  for (const key of dropped) {
    try {
      localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  }
  writeIndex(scope, keys);
}

export function readDailyCollectionsCacheEntry(
  query: DailyCollectionsCacheQuery
): DailyCollectionsCacheEntry | null {
  const stored = readJson<DailyCollectionsCacheEntry>(entryStorageKey(query));
  if (!stored?.result) return null;
  return stored;
}

export function readLatestDailyCollectionsCacheEntry(
  scope: DailyCollectionsCacheScope
): DailyCollectionsCacheEntry | null {
  const keys = readIndex(scope);
  for (const key of keys) {
    const stored = readJson<DailyCollectionsCacheEntry>(key);
    if (stored?.result) return stored;
  }
  return null;
}

export function writeDailyCollectionsCacheEntry(
  query: DailyCollectionsCacheQuery,
  result: DailyCollectionsResult
): void {
  const key = entryStorageKey(query);
  const entry: DailyCollectionsCacheEntry = {
    query,
    result,
    cachedAt: Date.now(),
  };
  if (!writeJson(key, entry)) return;
  pruneScopeIndex(
    {
      portal: query.portal,
      clinicId: query.clinicId,
      doctorId: query.doctorId,
    },
    key
  );
}

export function formatDailyCollectionsCachedAt(ts: number): string {
  try {
    return new Date(ts).toLocaleString("ar-IQ", {
      dateStyle: "short",
      timeStyle: "short",
    });
  } catch {
    return new Date(ts).toLocaleString();
  }
}

export async function fetchDailyCollectionsCached(input: {
  query: DailyCollectionsCacheQuery;
  apiPath: string;
  headers: HeadersInit;
  onCacheHit?: (result: DailyCollectionsResult, cachedAt: number) => void;
}): Promise<DailyCollectionsLoadResult> {
  const exact = readDailyCollectionsCacheEntry(input.query);
  const fallback =
    exact ??
    readLatestDailyCollectionsCacheEntry({
      portal: input.query.portal,
      clinicId: input.query.clinicId,
      doctorId: input.query.doctorId,
    });

  if (fallback?.result) {
    const reconciled = reconcileDailyCollectionsResult(fallback.result);
    if (reconciled) {
      input.onCacheHit?.(reconciled, fallback.cachedAt);
    }
  }

  if (isBrowserOffline()) {
    if (fallback?.result) {
      return {
        result: reconcileDailyCollectionsResult(fallback.result),
        source: "cache",
        cachedAt: fallback.cachedAt,
        offline: true,
      };
    }
    return { result: null, source: "none", cachedAt: null, offline: true };
  }

  try {
    const params = new URLSearchParams({
      date_from: input.query.dateFrom,
      date_to: input.query.dateTo,
      status_filter: "all",
      _t: String(Date.now()),
    });
    if (input.query.doctorId) {
      params.set("doctor_id", input.query.doctorId);
    }

    const res = await fetch(`${input.apiPath}?${params}`, {
      credentials: "include",
      headers: input.headers,
      cache: "no-store",
    });
    const json = (await res.json()) as {
      result?: DailyCollectionsResult;
      error?: string;
    };

    if (!res.ok) {
      if (fallback?.result) {
        return {
          result: reconcileDailyCollectionsResult(fallback.result),
          source: "cache",
          cachedAt: fallback.cachedAt,
          offline: false,
        };
      }
      return { result: null, source: "none", cachedAt: null, offline: false };
    }

    const reconciled = reconcileDailyCollectionsResult(json.result ?? null);
    if (reconciled) {
      writeDailyCollectionsCacheEntry(input.query, reconciled);
      return {
        result: reconciled,
        source: "network",
        cachedAt: Date.now(),
        offline: false,
      };
    }

    if (fallback?.result) {
      return {
        result: reconcileDailyCollectionsResult(fallback.result),
        source: "cache",
        cachedAt: fallback.cachedAt,
        offline: false,
      };
    }

    return { result: null, source: "none", cachedAt: null, offline: false };
  } catch {
    if (fallback?.result) {
      return {
        result: reconcileDailyCollectionsResult(fallback.result),
        source: "cache",
        cachedAt: fallback.cachedAt,
        offline: isBrowserOffline(),
      };
    }
    return {
      result: null,
      source: "none",
      cachedAt: null,
      offline: isBrowserOffline(),
    };
  }
}
