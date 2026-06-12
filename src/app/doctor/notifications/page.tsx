"use client";

import { NotificationsInbox } from "@/components/notifications/NotificationsInbox";
import type { NotificationRow } from "@/lib/notifications/client";

export default function DoctorNotificationsPage() {
  return (
    <NotificationsInbox
      portal="doctor"
      title="الإشعارات"
      resolveHref={(n: NotificationRow) =>
        n.link_path ?? "/doctor/wallet"
      }
    />
  );
}
