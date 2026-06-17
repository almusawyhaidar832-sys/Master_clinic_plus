const REF_KEY = "mcp_offline_reference_v1";
const DOCTORS_KEY = "mcp_offline_doctors_v1";

export interface OfflineReferenceData {
  clinicId: string;
  cachedAt: string;
}

export interface OfflineDoctorRef {
  id: string;
  full_name_ar: string;
  specialty_ar?: string | null;
}

export interface OfflineDoctorsCache {
  clinicId: string;
  doctors: OfflineDoctorRef[];
  cachedAt: string;
}

export function cacheOfflineReference(clinicId: string): void {
  if (typeof localStorage === "undefined" || !clinicId) return;
  try {
    const data: OfflineReferenceData = {
      clinicId,
      cachedAt: new Date().toISOString(),
    };
    localStorage.setItem(REF_KEY, JSON.stringify(data));
  } catch {
    /* quota */
  }
}

export function cacheOfflineDoctors(
  clinicId: string,
  doctors: OfflineDoctorRef[]
): void {
  if (typeof localStorage === "undefined" || !clinicId) return;
  try {
    const data: OfflineDoctorsCache = {
      clinicId,
      doctors,
      cachedAt: new Date().toISOString(),
    };
    localStorage.setItem(DOCTORS_KEY, JSON.stringify(data));
  } catch {
    /* quota */
  }
}

export function getCachedOfflineReference(): OfflineReferenceData | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(REF_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as OfflineReferenceData;
    if (!data.clinicId) return null;
    return data;
  } catch {
    return null;
  }
}

export function getCachedOfflineDoctors(
  clinicId?: string | null
): OfflineDoctorRef[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(DOCTORS_KEY);
    if (!raw) return [];
    const data = JSON.parse(raw) as OfflineDoctorsCache;
    if (!data.doctors?.length) return [];
    if (clinicId && data.clinicId !== clinicId) return [];
    return data.doctors;
  } catch {
    return [];
  }
}
