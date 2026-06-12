import type { SupabaseClient } from "@supabase/supabase-js";
import { authPortalHeaders } from "@/lib/auth/api-portal";
import { getAuthProfile } from "@/lib/clinic-context";

/** Owner (super_admin) or accountant — also accepts legacy alias "admin" */
export function isStaffRole(role: string | undefined | null): boolean {
  const r = String(role ?? "").trim().toLowerCase();
  return r === "accountant" || r === "super_admin" || r === "admin";
}

/** Can this session approve/reject withdrawals? */
export async function resolveCanManageWithdrawals(
  supabase: SupabaseClient
): Promise<boolean> {
  const profile = await getAuthProfile(supabase);
  if (isStaffRole(profile?.role)) return true;

  const { data: role } = await supabase.rpc("get_my_role");
  return isStaffRole(role as string | null);
}

export async function updateWithdrawalStatusClient(
  _supabase: SupabaseClient,
  id: string,
  status: "approved" | "paid" | "rejected",
  _processedBy: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const res = await fetch("/api/withdrawals/update-status", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authPortalHeaders("accountant"),
    },
    credentials: "include",
    body: JSON.stringify({ id, status }),
  });
  const json = (await res.json().catch(() => ({}))) as { error?: string };
  if (res.ok) return { ok: true };
  return {
    ok: false,
    error:
      json.error ||
      "تعذر تحديث الطلب — تأكد من صلاحيات المحاسب في قاعدة البيانات",
  };
}
