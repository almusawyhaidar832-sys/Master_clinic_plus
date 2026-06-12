"use client";

import { NotificationsInbox } from "@/components/notifications/NotificationsInbox";
import { useLanguage } from "@/contexts/LanguageContext";
import type { NotificationRow } from "@/lib/notifications/client";

export default function DoctorNotificationsPage() {
  const { t } = useLanguage();

  return (
    <NotificationsInbox
      portal="doctor"
      title={t("notifications")}
      resolveHref={(n: NotificationRow) =>
        n.link_path ?? "/doctor/wallet"
      }
    />
  );
}
