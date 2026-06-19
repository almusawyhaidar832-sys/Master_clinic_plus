import { authPortalHeaders } from "@/lib/auth/api-portal";
import type { AuthPortalId } from "@/lib/auth/portal-access";
import type { ClinicProfitStats } from "@/lib/services/clinic-stats";

/** نفس منطق التقرير — عبر API بصلاحيات السيرفر (يطابق لوحة المحاسب) */
export async function fetchClinicProfitStatsForPeriodViaApi(
  from: string,
  to: string,
  portal: AuthPortalId = "admin"
): Promise<ClinicProfitStats> {
  const res = await fetch(
    `/api/clinic/profit-stats?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
    {
      credentials: "include",
      headers: authPortalHeaders(portal),
    }
  );
  const json = (await res.json().catch(() => ({}))) as ClinicProfitStats & {
    error?: string;
  };
  if (!res.ok) {
    throw new Error(json.error ?? "تعذر تحميل بيانات الأرباح");
  }
  return json;
}
