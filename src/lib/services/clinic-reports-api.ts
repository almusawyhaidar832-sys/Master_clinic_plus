import { authPortalHeaders } from "@/lib/auth/api-portal";
import type { MasterClinicReport } from "@/lib/services/clinic-reports";

export async function fetchMasterClinicReportViaApi(
  monthYear: string
): Promise<MasterClinicReport> {
  const res = await fetch(
    `/api/admin/master-report?monthYear=${encodeURIComponent(monthYear)}`,
    {
      credentials: "include",
      headers: authPortalHeaders("admin"),
    }
  );
  const json = (await res.json().catch(() => ({}))) as MasterClinicReport & {
    error?: string;
  };
  if (!res.ok) {
    throw new Error(json.error ?? "تعذر إنشاء التقرير");
  }
  return json;
}
