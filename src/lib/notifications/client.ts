import { authPortalHeaders, type AuthPortalId } from "@/lib/auth/api-portal";
import { notifyClinicSync } from "@/lib/sync/clinic-events";

/** Columns that exist in all DB versions (link_path may be missing) */
export const NOTIFICATION_SELECT =
  "id, title_ar, body_ar, is_read, created_at, link_path";

export interface NotificationRow {
  id: string;
  title_ar: string;
  body_ar: string;
  is_read: boolean;
  created_at: string;
  link_path?: string | null;
}

/** Default link for accountant withdrawal alerts */
export function notificationActionHref(
  title: string,
  linkPath?: string | null
): string | null {
  if (linkPath?.trim()) return linkPath;
  if (title.includes("باركود")) return "/dashboard/queue";
  if (title.includes("مرتجع")) return "/doctor/notifications";
  if (title.includes("سحب")) return "/dashboard/withdrawals";
  if (title.includes("جلسة") || title.includes("مراجع")) return "/dashboard/ledger";
  return null;
}

/** روابط إشعارات الطبيب — غرفة الانتظار، الباركود، الدفع */
export function resolveDoctorNotificationHref(n: NotificationRow): string | null {
  if (n.link_path?.trim()) return n.link_path;

  const title = n.title_ar;
  if (
    title.includes("الانتظار") ||
    title.includes("غرفة") ||
    title.includes("تذكير — مراجع")
  ) {
    return "/doctor/queue";
  }
  if (title.includes("باركود")) return "/doctor/schedule";
  if (
    title.includes("تسديد") ||
    title.includes("دفعة") ||
    title.includes("دفع")
  ) {
    return "/doctor/financial-ledger?tab=patients";
  }

  return null;
}

/** أبلغ الواجهة بتحديث عداد الإشعارات */
export function notifyNotificationsRead(): void {
  notifyClinicSync({ topic: "notifications", source: "mutation" });
}

/** تعليم إشعار أو الكل كمقروء — عبر السيرفر لضمان التحديث */
export async function markNotificationsReadViaApi(
  portal: AuthPortalId,
  options: { all?: boolean; id?: string } = { all: true }
): Promise<boolean> {
  try {
    const res = await fetch("/api/notifications/mark-read", {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        ...authPortalHeaders(portal),
      },
      body: JSON.stringify(
        options.id ? { id: options.id } : { all: options.all ?? true }
      ),
    });
    if (res.ok) {
      notifyNotificationsRead();
      return true;
    }
  } catch {
    /* fallback below */
  }
  return false;
}
