import type { PatientProfilePortal } from "@/lib/offline/patient-profile-cache";

export type RecentPatientIndexEntry = {
  id: string;
  full_name_ar: string;
  phone?: string | null;
  total_debt?: number;
  touchedAt: number;
};

const INDEX_PREFIX = "mcp_recent_patients_v1:";
const MAX_RECENT = 80;

function indexKey(portal: PatientProfilePortal, clinicId: string): string {
  return `${INDEX_PREFIX}${portal}:${clinicId}`;
}

function readIndex(portal: PatientProfilePortal, clinicId: string): RecentPatientIndexEntry[] {
  if (typeof window === "undefined" || !clinicId) return [];
  try {
    const raw = localStorage.getItem(indexKey(portal, clinicId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as RecentPatientIndexEntry[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeIndex(
  portal: PatientProfilePortal,
  clinicId: string,
  entries: RecentPatientIndexEntry[]
): void {
  if (typeof window === "undefined" || !clinicId) return;
  try {
    localStorage.setItem(
      indexKey(portal, clinicId),
      JSON.stringify(entries.slice(0, MAX_RECENT))
    );
  } catch {
    /* quota */
  }
}

export function touchRecentPatient(
  portal: PatientProfilePortal,
  clinicId: string,
  patient: {
    id: string;
    full_name_ar: string;
    phone?: string | null;
    total_debt?: number;
  }
): void {
  if (!clinicId || !patient.id) return;
  const now = Date.now();
  const current = readIndex(portal, clinicId).filter((p) => p.id !== patient.id);
  current.unshift({
    id: patient.id,
    full_name_ar: patient.full_name_ar,
    phone: patient.phone ?? null,
    total_debt: patient.total_debt,
    touchedAt: now,
  });
  writeIndex(portal, clinicId, current);
}

export function mergeRecentPatients(
  portal: PatientProfilePortal,
  clinicId: string,
  patients: Array<{
    id: string;
    full_name_ar: string;
    phone?: string | null;
    total_debt?: number;
  }>
): void {
  if (!clinicId || !patients.length) return;
  const now = Date.now();
  const byId = new Map(readIndex(portal, clinicId).map((p) => [p.id, p]));
  for (const patient of patients) {
    byId.set(patient.id, {
      id: patient.id,
      full_name_ar: patient.full_name_ar,
      phone: patient.phone ?? null,
      total_debt: patient.total_debt,
      touchedAt: now,
    });
  }
  const merged = [...byId.values()].sort((a, b) => b.touchedAt - a.touchedAt);
  writeIndex(portal, clinicId, merged);
}

export function searchRecentPatients(
  portal: PatientProfilePortal,
  clinicId: string,
  query: string,
  limit = 30
): RecentPatientIndexEntry[] {
  const q = query.trim().toLowerCase();
  const all = readIndex(portal, clinicId);
  if (!q) return all.slice(0, limit);
  return all
    .filter((p) => {
      const name = p.full_name_ar.toLowerCase();
      const phone = String(p.phone ?? "").replace(/\s/g, "");
      return name.includes(q) || phone.includes(q.replace(/\s/g, ""));
    })
    .slice(0, limit);
}

export function listRecentPatients(
  portal: PatientProfilePortal,
  clinicId: string,
  limit = 30
): RecentPatientIndexEntry[] {
  return readIndex(portal, clinicId).slice(0, limit);
}
