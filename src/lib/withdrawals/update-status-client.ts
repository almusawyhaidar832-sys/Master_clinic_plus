import type { SupabaseClient } from "@supabase/supabase-js";
import { getAuthProfile } from "@/lib/clinic-context";
import { applyWithdrawalStatusUpdate } from "@/lib/withdrawals/status-update";

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
  supabase: SupabaseClient,
  id: string,
  status: "approved" | "paid" | "rejected",
  processedBy: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await applyWithdrawalStatusUpdate(
    supabase,
    id,
    status,
    processedBy
  );

  if (!error) {
    await dispatchWithdrawalNotification(id, status);
    return { ok: true };
  }

  const isRls =
    error.message.includes("permission") ||
    error.message.includes("policy") ||
    error.code === "42501";

  const isSchema =
    error.message.includes("processed_by") ||
    error.message.includes("schema cache") ||
    error.code === "PGRST204";

  if (isRls || isSchema) {
    const res = await fetch("/api/withdrawals/update-status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ id, status }),
    });
    const json = await res.json().catch(() => ({}));
    if (res.ok) return { ok: true };
    return {
      ok: false,
      error:
        (json as { error?: string }).error ||
        "تعذر تحديث الطلب — تأكد من صلاحيات المحاسب في قاعدة البيانات",
    };
  }

  return { ok: false, error: error.message || "تعذر تحديث الطلب" };
}

async function dispatchWithdrawalNotification(
  id: string,
  status: string
): Promise<void> {
  await fetch("/api/notifications/dispatch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({ event: "withdrawal_status", id, status }),
  }).catch(() => {});
}
