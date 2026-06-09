/** Columns that exist in all DB versions (link_path may be missing) */
export const NOTIFICATION_SELECT =
  "id, title_ar, body_ar, is_read, created_at";

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
  if (title.includes("مرتجع")) return "/doctor/notifications";
  if (title.includes("سحب")) return "/dashboard/withdrawals";
  if (title.includes("جلسة") || title.includes("مراجع")) return "/dashboard/ledger";
  return null;
}
