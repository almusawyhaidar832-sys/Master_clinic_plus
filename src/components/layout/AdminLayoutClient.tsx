"use client";

import { useEffect, useState } from "react";
import { AdminMobileShell } from "./AdminMobileShell";
import { createClient } from "@/lib/supabase/client";
import { fetchUnreadNotificationCount } from "@/lib/services/clinic-stats";
import { getAuthProfile } from "@/lib/clinic-context";

export function AdminLayoutClient({
  children,
}: {
  children: React.ReactNode;
}) {
  const [notificationCount, setNotificationCount] = useState(0);

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
    <AdminMobileShell notificationCount={notificationCount}>
      {children}
    </AdminMobileShell>
  );
}
