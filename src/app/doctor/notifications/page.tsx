"use client";

import { DoctorAlertsSetup } from "@/components/doctor/DoctorAlertsSetup";
import { NotificationsInbox } from "@/components/notifications/NotificationsInbox";
import { useLanguage } from "@/contexts/LanguageContext";
import {
  resolveDoctorNotificationHref,
  type NotificationRow,
} from "@/lib/notifications/client";

export default function DoctorNotificationsPage() {
  const { t } = useLanguage();

  return (
    <div className="space-y-4">
      <DoctorAlertsSetup showTestControls />
      <NotificationsInbox
        portal="doctor"
        title={t("notifications")}
        resolveHref={(n: NotificationRow) => resolveDoctorNotificationHref(n)}
      />
    </div>
  );
}
