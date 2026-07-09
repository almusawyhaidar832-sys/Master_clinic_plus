import type { ClinicalByOperationId } from "@/lib/clinical/types";
import type { PatientToothState } from "@/lib/clinical/tooth-status";
import type { PatientTreatmentCase } from "@/lib/services/patient-treatment-cases";
import type { MedicalLog, Patient, PatientOperation, Treatment } from "@/types";
import { touchRecentPatient } from "@/lib/offline/recent-patients-index";

export type PatientProfilePortal = "doctor" | "accountant";

export type PatientProfileCacheBundle = {
  portal: PatientProfilePortal;
  clinicId: string;
  patientId: string;
  doctorId?: string | null;
  patient: Patient;
  operations: PatientOperation[];
  treatmentCases: PatientTreatmentCase[];
  clinicalByOp: ClinicalByOperationId;
  medicalLogs: (MedicalLog & { doctor?: { full_name_ar: string } })[];
  treatments?: Treatment[];
  cachedAt: number;
};

const PROFILE_PREFIX = "mcp_patient_profile_v1:";
const MAX_PROFILES_PER_SCOPE = 30;

function profileKey(
  portal: PatientProfilePortal,
  clinicId: string,
  patientId: string
): string {
  return `${PROFILE_PREFIX}${portal}:${clinicId}:${patientId}`;
}

function profileIndexKey(
  portal: PatientProfilePortal,
  clinicId: string
): string {
  return `${PROFILE_PREFIX}index:${portal}:${clinicId}`;
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

function pruneProfileIndex(
  portal: PatientProfilePortal,
  clinicId: string,
  keepPatientId: string
): void {
  const indexKey = profileIndexKey(portal, clinicId);
  const ids = readJson<string[]>(indexKey) ?? [];
  const next = [keepPatientId, ...ids.filter((id) => id !== keepPatientId)].slice(
    0,
    MAX_PROFILES_PER_SCOPE
  );
  const dropped = ids.filter((id) => !next.includes(id));
  for (const id of dropped) {
    try {
      localStorage.removeItem(profileKey(portal, clinicId, id));
    } catch {
      /* ignore */
    }
  }
  writeJson(indexKey, next);
}

export function readPatientProfileCache(input: {
  portal: PatientProfilePortal;
  clinicId: string;
  patientId: string;
}): PatientProfileCacheBundle | null {
  const stored = readJson<PatientProfileCacheBundle>(
    profileKey(input.portal, input.clinicId, input.patientId)
  );
  if (!stored?.patient?.id) return null;
  return stored;
}

/** يبحث عن آخر نسخة محفوظة للمريض — مفيد عند فتح الملف بدون نت */
export function readPatientProfileCacheForPatient(
  portal: PatientProfilePortal,
  patientId: string,
  doctorId?: string | null
): PatientProfileCacheBundle | null {
  if (typeof window === "undefined") return null;
  const prefix = `${PROFILE_PREFIX}${portal}:`;
  let best: PatientProfileCacheBundle | null = null;

  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key?.startsWith(prefix) || key.includes("index:")) continue;
    if (!key.endsWith(`:${patientId}`)) continue;
    const stored = readJson<PatientProfileCacheBundle>(key);
    if (!stored?.patient?.id) continue;
    if (doctorId && stored.doctorId && stored.doctorId !== doctorId) continue;
    if (!best || stored.cachedAt > best.cachedAt) best = stored;
  }

  return best;
}

export function writePatientProfileCache(
  bundle: Omit<PatientProfileCacheBundle, "cachedAt"> & { cachedAt?: number }
): void {
  const entry: PatientProfileCacheBundle = {
    ...bundle,
    cachedAt: bundle.cachedAt ?? Date.now(),
  };
  const key = profileKey(entry.portal, entry.clinicId, entry.patientId);
  if (!writeJson(key, entry)) return;
  pruneProfileIndex(entry.portal, entry.clinicId, entry.patientId);
  touchRecentPatient(entry.portal, entry.clinicId, {
    id: entry.patient.id,
    full_name_ar: entry.patient.full_name_ar,
    phone: entry.patient.phone ?? null,
    total_debt: undefined,
  });
}

const TOOTH_CHART_PREFIX = "mcp_tooth_chart_v1:";

export function readPatientToothChartCache(
  clinicId: string,
  patientId: string
): { teeth: PatientToothState[]; cachedAt: number } | null {
  const stored = readJson<{ teeth: PatientToothState[]; cachedAt: number }>(
    `${TOOTH_CHART_PREFIX}${clinicId}:${patientId}`
  );
  if (!stored?.teeth) return null;
  return stored;
}

export function writePatientToothChartCache(
  clinicId: string,
  patientId: string,
  teeth: PatientToothState[]
): void {
  writeJson(`${TOOTH_CHART_PREFIX}${clinicId}:${patientId}`, {
    teeth,
    cachedAt: Date.now(),
  });
}
