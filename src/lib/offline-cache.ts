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

export function cacheAuthProfile(profile: Profile): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(
      AUTH_PROFILE_KEY,
      JSON.stringify({ profile, userId: profile.id, at: Date.now() })
    );
  } catch {
    /* quota / private mode */
  }
}

export function getCachedAuthProfile(userId: string): Profile | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(AUTH_PROFILE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as { profile: Profile; userId: string };
    return data.userId === userId ? data.profile : null;
  } catch {
    return null;
  }
}

export function cacheClinicProfile(profile: ClinicProfile): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(
      CLINIC_PROFILE_KEY,
      JSON.stringify({ profile, clinicId: profile.id, at: Date.now() })
    );
  } catch {
    /* ignore */
  }
}

export function getCachedClinicProfile(clinicId: string): ClinicProfile | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(CLINIC_PROFILE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as { profile: ClinicProfile; clinicId: string };
    return data.clinicId === clinicId ? data.profile : null;
  } catch {
    return null;
  }
}

export function cachePortalQueue<T>(
  portal: "doctor" | "assistant",
  doctorId: string | null,
  queue: T[]
): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(
      PORTAL_QUEUE_KEY,
      JSON.stringify({ portal, doctorId, queue, at: Date.now() })
    );
  } catch {
    /* ignore */
  }
}

export function getCachedPortalQueue<T>(
  portal: "doctor" | "assistant",
  doctorId: string | null
): T[] | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(PORTAL_QUEUE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as {
      portal: string;
      doctorId: string | null;
      queue: T[];
    };
    if (data.portal !== portal) return null;
    if (doctorId && data.doctorId !== doctorId) return null;
    return data.queue;
  } catch {
    return null;
  }
}
