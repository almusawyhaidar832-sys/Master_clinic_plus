import { authPortalHeaders } from "@/lib/auth/api-portal";
import type { AuthPortalId } from "@/lib/auth/portal-access";
import type { ClinicProfitStats } from "@/lib/services/clinic-stats";

/** نفس منطق التقرير — عبر API بصلاحيات السيرفر (يطابق لوحة المحاسب) */
export async function fetchClinicProfitStatsForPeriodViaApi(
  from: string,
  to: string,
  portal: AuthPortalId = "admin",
  clinicId?: string | null
): Promise<ClinicProfitStats> {
  const params = new URLSearchParams({
    from,
    to,
    _t: String(Date.now()),
  });
  if (clinicId) {
    params.set("clinic_id", clinicId);
  }

  const res = await fetch(`/api/clinic/profit-stats?${params.toString()}`, {
    credentials: "include",
    headers: authPortalHeaders(portal),
    cache: "no-store",
  });
  const json = (await res.json().catch(() => ({}))) as ClinicProfitStats & {
    error?: string;
  };
  if (!res.ok) {
    throw new Error(json.error ?? "تعذر تحميل بيانات الأرباح");
  }
  return json;
}
