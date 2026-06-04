import type { ActiveClinicResult } from "@/lib/clinic-types";

/** يقرأ العيادة النشطة من كوكي المطور (للمتصفح فقط) */
export async function fetchDeveloperActingClinic(): Promise<ActiveClinicResult | null> {
  if (typeof window === "undefined") return null;
  try {
    const res = await fetch("/api/developer/session", {
      credentials: "include",
      cache: "no-store",
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      actingClinicId?: string | null;
      clinicName?: string | null;
    };
    if (!data.actingClinicId) return null;
    return {
      clinicId: data.actingClinicId,
      clinicName: data.clinicName?.trim() || "",
      source: "developer",
    };
  } catch {
    return null;
  }
}
