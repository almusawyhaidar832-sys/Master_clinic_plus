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

/** يتحقق أن الموظف يصل للعيادة المطلوبة — عيادة حسابه أو عيادة الدخول نيابة (مطوّر) فقط */
export async function verifyStaffClinicAccess(
  req: NextRequest,
  caller: CallerProfile,
  clinicId: string
): Promise<boolean> {
  if (!isApiStaffRole(caller.role)) return false;

  const actingClinicId =
    (await resolveDeveloperActingClinicId(req)) ?? headerActingClinicId(req);
  const sessionClinicId = await getApiActiveClinicId(req);
  const profileClinicId = caller.clinic_id ?? null;

  const allowed = new Set(
    [sessionClinicId, profileClinicId, actingClinicId].filter(
      (id): id is string => Boolean(id)
    )
  );

  return allowed.has(clinicId);
}

/** يحدّد العيادة من الطلب — يطابق العيادة النشطة في الواجهة */
export async function resolveStaffApiClinicId(
  req: NextRequest,
  caller: CallerProfile
): Promise<string | null> {
  const fromQuery = req.nextUrl.searchParams.get("clinic_id")?.trim() || null;

  if (fromQuery) {
    if (await verifyStaffClinicAccess(req, caller, fromQuery)) {
      return fromQuery;
    }
    return null;
  }

  const actingClinicId =
    (await resolveDeveloperActingClinicId(req)) ?? headerActingClinicId(req);
  const sessionClinicId = await getApiActiveClinicId(req);
  const profileClinicId = caller.clinic_id ?? null;

  return sessionClinicId ?? actingClinicId ?? profileClinicId ?? null;
}
