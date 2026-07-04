import type { NextRequest } from "next/server";
import {
  getApiActiveClinicId,
  getApiCallerProfile,
} from "@/lib/auth/api-session";

type PayrollCaller = Awaited<ReturnType<typeof getApiCallerProfile>>;

export type ResolvePayrollClinicResult =
  | { ok: true; clinicId: string; caller: NonNullable<PayrollCaller> }
  | { ok: false; status: number; error: string };

const PAYROLL_ROLES = ["accountant", "super_admin"] as const;

/**
 * عزل رواتب العيادة — مصدر واحد للعيادة النشطة (profile + دخول نيابة).
 * إذا أرسل العميل clinic_id يجب أن يطابق العيادة المحلولة وإلا 403.
 */
export async function resolvePayrollApiClinic(
  req: NextRequest,
  opts?: { requestedClinicId?: string | null }
): Promise<ResolvePayrollClinicResult> {
  const caller = await getApiCallerProfile(req);
  if (!caller) {
    return { ok: false, status: 401, error: "يجب تسجيل الدخول أولاً" };
  }

  if (!PAYROLL_ROLES.includes(caller.role as (typeof PAYROLL_ROLES)[number])) {
    return { ok: false, status: 403, error: "صلاحيات غير كافية" };
  }

  const clinicId = await getApiActiveClinicId(req);
  if (!clinicId) {
    return { ok: false, status: 400, error: "حسابك غير مربوط بعيادة" };
  }

  const requested = opts?.requestedClinicId?.trim();
  if (requested && requested !== clinicId) {
    return {
      ok: false,
      status: 403,
      error:
        "تعارض العيادة — البيانات المعروضة لعيادة أخرى. حدّث الصفحة أو أعد تسجيل الدخول.",
    };
  }

  return { ok: true, clinicId, caller };
}

export function payrollClinicQueryParam(req: NextRequest): string | null {
  return req.nextUrl.searchParams.get("clinic_id")?.trim() ?? null;
}
