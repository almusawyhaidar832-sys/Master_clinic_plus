"use client";

import { useCallback, useEffect, useState } from "react";
import { AdminMobileShell } from "./AdminMobileShell";
import { createClient } from "@/lib/supabase/client";
import { fetchUnreadNotificationCount } from "@/lib/services/clinic-stats";
import { getAuthProfile } from "@/lib/clinic-context";
import { useClinicSync } from "@/hooks/useClinicSync";
import { useClinicProfile } from "@/contexts/ClinicProfileContext";

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
    const count = await fetchUnreadNotificationCount(supabase, authProfile.id);
    setNotificationCount(count);
  }, []);

  useEffect(() => {
    void loadNotifications();
    const interval = setInterval(() => void loadNotifications(), 30_000);
    return () => clearInterval(interval);
  }, [loadNotifications]);

  useClinicSync({
    topics: ["notifications"],
    clinicId: profile?.id,
    onRefresh: loadNotifications,
    enabled: !!profile?.id,
  });

  return (
    <AdminMobileShell notificationCount={notificationCount}>
      {children}
    </AdminMobileShell>
  );
}
