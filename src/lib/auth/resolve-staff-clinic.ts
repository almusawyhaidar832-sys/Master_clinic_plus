import type { NextRequest } from "next/server";
import { getApiActiveClinicId } from "@/lib/auth/api-session";
import { isApiStaffRole } from "@/lib/auth/api-portal";
import { DEVELOPER_CLINIC_HEADER } from "@/lib/auth/developer-gate";
import { resolveDeveloperActingClinicId } from "@/lib/auth/developer-impersonation";

type CallerProfile = {
  clinic_id: string | null;
  role?: string | null;
};

function headerActingClinicId(req: NextRequest): string | null {
  return req.headers.get(DEVELOPER_CLINIC_HEADER)?.trim() || null;
}

function clientHeaderClinicId(req: NextRequest): string | null {
  return req.headers.get("x-clinic-id")?.trim() || null;
}

/** يحدّد العيادة من الطلب — يطابق العيادة النشطة في الواجهة */
export async function resolveStaffApiClinicId(
  req: NextRequest,
  caller: CallerProfile
): Promise<string | null> {
  const fromQuery = req.nextUrl.searchParams.get("clinic_id")?.trim() || null;
  const actingClinicId =
    (await resolveDeveloperActingClinicId(req)) ?? headerActingClinicId(req);
  const sessionClinicId = await getApiActiveClinicId(req);
  const profileClinicId = caller.clinic_id ?? null;
  const uiClinicId = clientHeaderClinicId(req);

  const allowed = new Set(
    [sessionClinicId, profileClinicId, actingClinicId, uiClinicId].filter(
      (id): id is string => Boolean(id)
    )
  );

  if (fromQuery) {
    if (allowed.has(fromQuery)) {
      return fromQuery;
    }
    if (
      isApiStaffRole(caller.role) &&
      uiClinicId &&
      fromQuery === uiClinicId &&
      (profileClinicId === fromQuery ||
        actingClinicId === fromQuery ||
        sessionClinicId === fromQuery)
    ) {
      return fromQuery;
    }
    return null;
  }

  return sessionClinicId ?? actingClinicId ?? profileClinicId ?? null;
}
