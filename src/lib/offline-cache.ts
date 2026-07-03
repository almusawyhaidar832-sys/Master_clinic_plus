/** Doctor PWA offline cache keys */

import type { Profile } from "@/types";
import type { ClinicProfile } from "@/types/clinic-profile";

const PREFIX = "mcp_doctor_";
const AUTH_PROFILE_KEY = `${PREFIX}auth_profile`;
const CLINIC_PROFILE_KEY = `${PREFIX}clinic_profile`;
const PORTAL_QUEUE_KEY = `${PREFIX}portal_queue`;

export const OFFLINE_KEYS = {
  balance: `${PREFIX}balance`,
  patients: `${PREFIX}recent_patients`,
  lastSync: `${PREFIX}last_sync`,
} as const;

export function cacheDoctorBalance(balance: number, doctorId: string) {
  if (typeof window === "undefined") return;
  localStorage.setItem(
    OFFLINE_KEYS.balance,
    JSON.stringify({ balance, doctorId, at: Date.now() })
  );
}

export function getCachedDoctorBalance(doctorId: string): number | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(OFFLINE_KEYS.balance);
    if (!raw) return null;
    const data = JSON.parse(raw) as { balance: number; doctorId: string };
    return data.doctorId === doctorId ? data.balance : null;
  } catch {
    return null;
  }
}

export function cacheRecentPatients<T extends { id: string }>(patients: T[]) {
  if (typeof window === "undefined") return;
  localStorage.setItem(
    OFFLINE_KEYS.patients,
    JSON.stringify({ patients, at: Date.now() })
  );
}

export function getCachedRecentPatients<T>(): T[] | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(OFFLINE_KEYS.patients);
    if (!raw) return null;
    const data = JSON.parse(raw) as { patients: T[] };
    return data.patients;
  } catch {
    return null;
  }
}

export function isBrowserOffline(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

function readPersistedJson<T>(key: string): T | null {
  if (typeof window === "undefined") return null;
  try {
    const raw =
      localStorage.getItem(key) ?? sessionStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function writePersistedJson(key: string, value: unknown): void {
  if (typeof window === "undefined") return;
  try {
    const serialized = JSON.stringify(value);
    localStorage.setItem(key, serialized);
    sessionStorage.removeItem(key);
  } catch {
    /* quota / private mode */
  }
}

export function cacheAuthProfile(profile: Profile): void {
  writePersistedJson(AUTH_PROFILE_KEY, {
    profile,
    userId: profile.id,
    at: Date.now(),
  });
}

export function getCachedAuthProfile(userId: string): Profile | null {
  const data = readPersistedJson<{ profile: Profile; userId: string }>(
    AUTH_PROFILE_KEY
  );
  return data?.userId === userId ? data.profile : null;
}

export function cacheClinicProfile(profile: ClinicProfile): void {
  writePersistedJson(CLINIC_PROFILE_KEY, {
    profile,
    clinicId: profile.id,
    at: Date.now(),
  });
}

export function getCachedClinicProfile(clinicId: string): ClinicProfile | null {
  const data = readPersistedJson<{
    profile: ClinicProfile;
    clinicId: string;
  }>(CLINIC_PROFILE_KEY);
  return data?.clinicId === clinicId ? data.profile : null;
}

export function cachePortalQueue<T>(
  portal: "doctor" | "assistant",
  doctorId: string | null,
  queue: T[]
): void {
  writePersistedJson(PORTAL_QUEUE_KEY, {
    portal,
    doctorId,
    queue,
    at: Date.now(),
  });
}

export function getCachedPortalQueue<T>(
  portal: "doctor" | "assistant",
  doctorId: string | null
): T[] | null {
  const data = readPersistedJson<{
    portal: string;
    doctorId: string | null;
    queue: T[];
  }>(PORTAL_QUEUE_KEY);
  if (!data) return null;
  if (data.portal !== portal) return null;
  if (doctorId && data.doctorId !== doctorId) return null;
  return data.queue;
}
