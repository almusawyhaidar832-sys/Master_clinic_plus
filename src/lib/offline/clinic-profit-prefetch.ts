import { createClient } from "@/lib/supabase/client";
import { getActiveClinicId } from "@/lib/clinic-context";
import {
  defaultClinicProfitPeriod,
  fetchAlignedClinicProfitStats,
} from "@/lib/services/clinic-profit-loader";
import { isBrowserOffline } from "@/lib/offline/network";
import { writeClinicProfitViewCache } from "@/lib/offline/clinic-profit-view-cache";
import { authPortalHeaders } from "@/lib/auth/api-portal";

async function fetchOutstandingDebt(
  portal: "admin" | "accountant",
  from: string,
  to: string,
  clinicId: string
): Promise<number | null> {
  try {
    const params = new URLSearchParams({ from, to, clinic_id: clinicId });
    const res = await fetch(`/api/executive/supplement?${params.toString()}`, {
      credentials: "include",
      headers: authPortalHeaders(portal),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      totalDebt?: { debt: number };
    };
    return json.totalDebt?.debt ?? null;
  } catch {
    return null;
  }
}

export async function prefetchAdminHomeProfitCache(): Promise<void> {
  if (isBrowserOffline()) return;
  const supabase = createClient();
  const clinic = await getActiveClinicId(supabase);
  if (!clinic?.clinicId) return;

  const period = defaultClinicProfitPeriod();
  try {
    const [stats, outstandingDebts, pending, doctors] = await Promise.all([
      fetchAlignedClinicProfitStats(clinic.clinicId, "admin", period),
      fetchOutstandingDebt("admin", period.from, period.to, clinic.clinicId),
      supabase
        .from("doctor_withdrawals")
        .select("*", { count: "exact", head: true })
        .eq("clinic_id", clinic.clinicId)
        .eq("status", "pending"),
      supabase
        .from("doctors")
        .select("id", { count: "exact", head: true })
        .eq("clinic_id", clinic.clinicId)
        .eq("is_active", true),
    ]);

    writeClinicProfitViewCache({
      portal: "admin",
      clinicId: clinic.clinicId,
      from: period.from,
      to: period.to,
      stats:
        outstandingDebts !== null
          ? { ...stats, outstandingDebts }
          : stats,
      outstandingDebts,
      pendingCount: pending.count ?? 0,
      doctorCount: doctors.count ?? 0,
    });
  } catch {
    /* prefetch is best-effort */
  }
}
