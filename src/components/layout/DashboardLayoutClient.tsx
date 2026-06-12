"use client";

import { useCallback, useEffect, useState } from "react";
import { DashboardShell } from "./DashboardShell";
import { accountantModuleNav, superAdminModuleNav } from "@/config/navigation";
import { createClient } from "@/lib/supabase/client";
import { fetchUnreadNotificationCount } from "@/lib/services/clinic-stats";
import { getAuthProfile } from "@/lib/clinic-context";
import { useClinicProfile } from "@/contexts/ClinicProfileContext";
import { useClinicModules } from "@/contexts/ClinicModulesContext";
import { useModuleNav } from "@/hooks/useModuleNav";
import { useClinicSync } from "@/hooks/useClinicSync";
import { useLanguage } from "@/contexts/LanguageContext";
import { DeveloperImpersonationBanner } from "@/components/developer/DeveloperImpersonationBanner";
import { ClinicDataSyncBridge } from "@/components/sync/ClinicDataSyncBridge";
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
  const { t } = useLanguage();

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
      label: t(i.labelKey),
      icon: i.icon,
      roles: i.roles,
    }));

  const loadNotifications = useCallback(async () => {
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
  }, []);

  useEffect(() => {
    void loadNotifications();
    const interval = setInterval(() => void loadNotifications(), 30_000);
    return () => clearInterval(interval);
  }, [loadNotifications]);

  useClinicSync({
    topics: ["sessions", "refunds", "queue", "appointments", "notifications"],
    clinicId: profile?.id,
    onRefresh: loadNotifications,
    enabled: !!profile?.id,
  });

  const isOwner = userRole === "super_admin";
  const headerTitle =
    staffName ||
    (isOwner ? t("clinicOwner") : t("accountantStaff"));
  const headerSubtitle = isOwner
    ? `${displayName} — ${t("ownerDashboardSubtitle")}`
    : `${displayName} — ${t("accountantDashboardSubtitle")}${specialtyLabel ? ` · ${specialtyLabel}` : ""}`;

  return (
    <DashboardShell
      navItems={navItems}
      title={headerTitle}
      subtitle={headerSubtitle}
      clinicLogoUrl={profile?.logo_url}
      clinicName={displayName}
      staffLabel={isOwner ? t("ownerLabel") : t("accountantStaff")}
      notificationCount={notificationCount}
      showGlobalSync={userRole === "super_admin"}
      clinicId={profile?.id}
    >
      <DeveloperImpersonationBanner />
      <ClinicDataSyncBridge />
      {children}
    </DashboardShell>
  );
}
