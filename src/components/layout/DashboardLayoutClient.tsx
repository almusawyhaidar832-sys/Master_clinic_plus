"use client";

import { useEffect, useState } from "react";
import { DashboardShell } from "./DashboardShell";
import { accountantNav } from "@/config/navigation";
import { createClient } from "@/lib/supabase/client";
import { fetchUnreadNotificationCount } from "@/lib/services/clinic-stats";
import { getAuthProfile } from "@/lib/clinic-context";
import { useClinicProfile } from "@/contexts/ClinicProfileContext";

export function DashboardLayoutClient({
  children,
}: {
  children: React.ReactNode;
}) {
  const [notificationCount, setNotificationCount] = useState(0);
  const { displayName, profile } = useClinicProfile();

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const profile = await getAuthProfile(supabase);
      if (!profile) return;
      const count = await fetchUnreadNotificationCount(supabase, profile.id);
      setNotificationCount(count);
    }
    load();
    const interval = setInterval(load, 30000);
    return () => clearInterval(interval);
  }, []);

  return (
    <DashboardShell
      navItems={accountantNav}
      title={displayName}
      subtitle="لوحة المحاسب"
      clinicLogoUrl={profile?.logo_url}
      notificationCount={notificationCount}
    >
      {children}
    </DashboardShell>
  );
}
