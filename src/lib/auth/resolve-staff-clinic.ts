import type { NextRequest } from "next/server";
import { getApiActiveClinicId } from "@/lib/auth/api-session";

type CallerProfile = {
  clinic_id: string | null;
};

/** يحدّد العيادة من الطلب — يطابق العيادة النشطة في الواجهة */
export async function resolveStaffApiClinicId(
  req: NextRequest,
  caller: CallerProfile
): Promise<string | null> {
  const fromQuery = req.nextUrl.searchParams.get("clinic_id")?.trim() || null;
  const sessionClinicId = await getApiActiveClinicId(req);

  if (fromQuery) {
    if (sessionClinicId && fromQuery === sessionClinicId) {
      return fromQuery;
    }
    if (caller.clinic_id && fromQuery === caller.clinic_id) {
      return fromQuery;
    }
    return null;
  }

  return sessionClinicId ?? caller.clinic_id ?? null;
}
