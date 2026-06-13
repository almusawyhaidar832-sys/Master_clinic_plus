import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  getApiCallerProfile,
  isApiStaffRole,
} from "@/lib/auth/api-session";
import { getDeveloperSessionFromRequest } from "@/lib/auth/developer-gate";

type CallerProfile = Awaited<ReturnType<typeof getApiCallerProfile>>;

type AccessResult =
  | { ok: true; profile: CallerProfile }
  | { ok: false; response: NextResponse };

/** Accountant / platform developer — required for QR, restart, status. */
export async function requireWhatsAppManageAccess(
  req: NextRequest
): Promise<AccessResult> {
  const devSession = await getDeveloperSessionFromRequest(req);
  if (devSession) {
    return { ok: true, profile: null };
  }

  const profile = await getApiCallerProfile(req);
  if (!profile) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "غير مصرح — سجّل الدخول" },
        { status: 401 }
      ),
    };
  }

  if (!isApiStaffRole(profile.role)) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "صلاحيات غير كافية — المحاسب فقط" },
        { status: 403 }
      ),
    };
  }

  if (!profile.clinic_id) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "حساب بدون عيادة" },
        { status: 403 }
      ),
    };
  }

  return { ok: true, profile };
}
