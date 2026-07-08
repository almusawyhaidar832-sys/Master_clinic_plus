import type { NextRequest } from "next/server";
import { getApiActiveClinicId } from "@/lib/auth/api-session";
import { resolveDeveloperActingClinicId } from "@/lib/auth/developer-impersonation";

type CallerProfile = {
  clinic_id: string | null;
};

/** يحدّد العيادة من الطلب — يطابق العيادة النشطة في الواجهة */
export async function resolveStaffApiClinicId(
  req: NextRequest,
  caller: CallerProfile
): Promise<string | null> {
  const fromQuery = req.nextUrl.searchParams.get("clinic_id")?.trim() || null;
  const actingClinicId = await resolveDeveloperActingClinicId(req);
  const sessionClinicId = await getApiActiveClinicId(req);
  const profileClinicId = caller.clinic_id ?? null;

  const allowed = new Set(
    [sessionClinicId, profileClinicId, actingClinicId].filter(
      (id): id is string => Boolean(id)
    )
  );

  if (fromQuery) {
    if (allowed.has(fromQuery)) {
      return fromQuery;
    }
    return null;
  }

  return sessionClinicId ?? profileClinicId ?? null;
}
