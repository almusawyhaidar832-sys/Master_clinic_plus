"use client";

import { useEffect, useState } from "react";
import { DashboardShell } from "./DashboardShell";
import { accountantModuleNav, superAdminModuleNav } from "@/config/navigation";
import { createClient } from "@/lib/supabase/client";
import { fetchUnreadNotificationCount } from "@/lib/services/clinic-stats";
import { getAuthProfile } from "@/lib/clinic-context";
import { useClinicProfile } from "@/contexts/ClinicProfileContext";
import { useClinicModules } from "@/contexts/ClinicModulesContext";
import { useModuleNav } from "@/hooks/useModuleNav";
import { DeveloperImpersonationBanner } from "@/components/developer/DeveloperImpersonationBanner";
import type { NavItem, UserRole } from "@/types";

export function DashboardLayoutClient({
  children,
}: {
  children: React.ReactNode;
}) {
  const [notificationCount, setNotificationCount] = useState(0);
  const [userRole, setUserRole] = useState<string>("accountant");
  const [staffName, setStaffName] = useState<string>("");
  const { displayName, profile } = useClinicProfile();
  const { specialtyLabel } = useClinicModules();

  // Pick the right base nav by role, then filter by enabled modules
  const baseNav = userRole === "super_admin" ? superAdminModuleNav : accountantModuleNav;
  const filteredModuleNav = useModuleNav(baseNav);

  // Convert to NavItem shape that DashboardShell / Sidebar expects
  const navItems: NavItem[] = filteredModuleNav
    .filter(
      (i) =>
        !i.roles?.length ||
        i.roles.includes(userRole as UserRole)
    )
    .map((i) => ({
      href: i.href,
      label: i.label,
      icon: i.icon,
      roles: i.roles,
    }));

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const authProfile = await getAuthProfile(supabase);
      if (!authProfile) return;
      setUserRole(authProfile.role);
      setStaffName(
        authProfile.full_name?.trim() ||
          authProfile.username?.trim() ||
          ""
      );
      const count = await fetchUnreadNotificationCount(supabase, authProfile.id);
      setNotificationCount(count);
    }
    load();
    const interval = setInterval(load, 30_000);
    return () => clearInterval(interval);
  }, []);

  const isOwner = userRole === "super_admin";
  const headerTitle =
    staffName ||
    (isOwner ? "مدير العيادة" : "المحاسب");
  const headerSubtitle = isOwner
    ? `${displayName} — لوحة الإدارة`
    : `${displayName} — لوحة المحاسب${specialtyLabel ? ` · ${specialtyLabel}` : ""}`;

  return (
    <DashboardShell
      navItems={navItems}
      title={headerTitle}
      subtitle={headerSubtitle}
      clinicLogoUrl={profile?.logo_url}
      clinicName={displayName}
      staffLabel={isOwner ? "المالك" : "المحاسب"}
      notificationCount={notificationCount}
    >
      <DeveloperImpersonationBanner />
      {children}
    </DashboardShell>
  );
}
