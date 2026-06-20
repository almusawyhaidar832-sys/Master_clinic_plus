import { authPortalHeaders, type AuthPortalId } from "@/lib/auth/api-portal";
import { notifyClinicSync } from "@/lib/sync/clinic-events";

/** أعمدة أساسية — link_path قد يكون غير موجود في بعض قواعد البيانات */
export const NOTIFICATION_SELECT_BASE =
  "id, title_ar, body_ar, is_read, created_at";

/** @deprecated prefer fetchNotificationsInboxViaApi */
export const NOTIFICATION_SELECT = `${NOTIFICATION_SELECT_BASE}, link_path`;

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

/** جلب الإشعارات عبر السيرفر — يتجاوز RLS ومشاكل عمود link_path */
export async function fetchNotificationsInboxViaApi(
  portal: AuthPortalId
): Promise<{
  ok: boolean;
  items?: NotificationRow[];
  unreadCount?: number;
  error?: string;
}> {
  try {
    const res = await fetch("/api/notifications/inbox", {
      credentials: "include",
      headers: authPortalHeaders(portal),
    });
    const json = (await res.json()) as {
      items?: NotificationRow[];
      unread_count?: number;
      error?: string;
    };
    if (!res.ok) {
      return { ok: false, error: json.error ?? "تعذر تحميل الإشعارات" };
    }
    return {
      ok: true,
      items: json.items ?? [],
      unreadCount: json.unread_count ?? 0,
    };
  } catch {
    return { ok: false, error: "تعذر تحميل الإشعارات" };
  }
}

/** عدد الإشعارات غير المقروءة — عبر السيرفر */
export async function fetchUnreadNotificationCountViaApi(
  portal: AuthPortalId
): Promise<number> {
  const result = await fetchNotificationsInboxViaApi(portal);
  return result.ok ? (result.unreadCount ?? 0) : 0;
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
