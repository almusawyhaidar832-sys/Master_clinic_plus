import type { DoctorWalletStats } from "@/lib/services/doctor-wallet";
import { reconcilePendingDoctorWallet } from "@/lib/services/doctor-wallet-pending";

const CACHE_PREFIX = "mcp_doctor_wallet_v1:";

export type DoctorWalletCacheEntry = {
  doctorId: string;
  stats: DoctorWalletStats;
  cachedAt: number;
};

function storageKey(doctorId: string): string {
  return `${CACHE_PREFIX}${doctorId}`;
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

export function readDoctorWalletCache(
  doctorId: string
): DoctorWalletCacheEntry | null {
  if (!doctorId) return null;
  const stored = readJson<DoctorWalletCacheEntry>(storageKey(doctorId));
  if (!stored?.stats || stored.doctorId !== doctorId) return null;
  return {
    ...stored,
    stats: reconcilePendingDoctorWallet(doctorId, stored.stats),
  };
}

export function writeDoctorWalletCache(
  doctorId: string,
  stats: DoctorWalletStats
): void {
  if (!doctorId) return;
  const entry: DoctorWalletCacheEntry = {
    doctorId,
    stats: reconcilePendingDoctorWallet(doctorId, stats),
    cachedAt: Date.now(),
  };
  writeJson(storageKey(doctorId), entry);
}
