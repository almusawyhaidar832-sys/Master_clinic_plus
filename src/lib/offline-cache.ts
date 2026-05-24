/** Doctor PWA offline cache keys */

const PREFIX = "mcp_doctor_";

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
