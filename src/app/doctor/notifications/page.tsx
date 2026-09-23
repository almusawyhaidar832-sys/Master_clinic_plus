"use client";

import { DoctorAlertsSetup } from "@/components/doctor/DoctorAlertsSetup";
import { NotificationsInbox } from "@/components/notifications/NotificationsInbox";
import { PageHeader } from "@/components/ui/PageHeader";
import { useLanguage } from "@/contexts/LanguageContext";
import {
  resolveDoctorNotificationHref,
  type NotificationRow,
} from "@/lib/notifications/client";
import { Bell, BellRing } from "lucide-react";

export default function DoctorNotificationsPage() {
  const { t, bi } = useLanguage();

  return (
    <div className="space-y-5 animate-fade-in">
      <PageHeader
        title={t("notifications")}
        eyebrow={bi("بوابة الطبيب", "Doctor portal")}
        icon={Bell}
        className="!mb-0"
      />

      <section className="space-y-3">
        <div className="flex items-center gap-3 px-1">
          <h2 className="no-accent flex items-center gap-2 text-sm font-bold text-slate-text">
            <BellRing className="h-4 w-4 text-premium-500" />
            {bi("إعدادات التنبيه", "Alert settings")}
          </h2>
          <span className="h-px flex-1 bg-gradient-to-l from-transparent to-slate-border" />
        </div>
        <DoctorAlertsSetup showTestControls />
      </section>

      <section className="[&_h2]:!text-lg">
        <NotificationsInbox
          portal="doctor"
          title={bi("صندوق الإشعارات", "Inbox")}
          resolveHref={(n: NotificationRow) => resolveDoctorNotificationHref(n)}
        />
      </section>
    </div>
  );
}
