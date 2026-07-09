"use client";

import { useCallback, useEffect, useState } from "react";
import { AdminMobileShell } from "./AdminMobileShell";
import { createClient } from "@/lib/supabase/client";
import { fetchUnreadNotificationCountViaApi } from "@/lib/notifications/client";
import { getAuthProfile } from "@/lib/clinic-context";
import { useClinicSync } from "@/hooks/useClinicSync";
import { useClinicProfile } from "@/contexts/ClinicProfileContext";
import { ClinicDataSyncBridge } from "@/components/sync/ClinicDataSyncBridge";
import { warmAdminShellCache } from "@/lib/pwa/admin-shell-cache";
import { prefetchAdminHomeProfitCache } from "@/lib/offline/clinic-profit-prefetch";
import { onOfflineReconnect } from "@/lib/offline/reconnect-coordinator";

export function AdminLayoutClient({
  children,
}: {
  children: React.ReactNode;
}) {
  const [notificationCount, setNotificationCount] = useState(0);
  const { profile } = useClinicProfile();

  const loadNotifications = useCallback(async () => {
    const supabase = createClient();
    const authProfile = await getAuthProfile(supabase);
    if (!authProfile) return;
    const count = await fetchUnreadNotificationCountViaApi("admin");
    setNotificationCount(count);
  }, []);

  useEffect(() => {
    void loadNotifications();
    const interval = setInterval(() => void loadNotifications(), 30_000);
    return () => clearInterval(interval);
  }, [loadNotifications]);

  useEffect(() => {
    const warm = () => {
      void warmAdminShellCache();
      void prefetchAdminHomeProfitCache();
    };

    warm();
    const unsubReconnect = onOfflineReconnect(warm);
    const onOnline = () => warm();
    window.addEventListener("online", onOnline);
    return () => {
      unsubReconnect();
      window.removeEventListener("online", onOnline);
    };
  }, []);

  useClinicSync({
    topics: ["notifications"],
    clinicId: profile?.id,
    onRefresh: loadNotifications,
    enabled: !!profile?.id,
  });

  return (
    <AdminMobileShell notificationCount={notificationCount}>
      <ClinicDataSyncBridge />
      {children}
    </AdminMobileShell>
  );
}
