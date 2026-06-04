"use client";

import { useState } from "react";
import { Sidebar } from "./Sidebar";
import { Header } from "./Header";
import type { NavItem } from "@/types";
import { logoutFromCurrentPortal } from "@/lib/auth/logout-portal";
import { useRouter } from "next/navigation";

interface DashboardShellProps {
  children: React.ReactNode;
  navItems: NavItem[];
  /** Logged-in staff name (accountant / owner) */
  title: string;
  subtitle?: string;
  /** Clinic name in sidebar */
  clinicName?: string;
  staffLabel?: string;
  clinicLogoUrl?: string | null;
  notificationCount?: number;
}

export function DashboardShell({
  children,
  navItems,
  title,
  subtitle,
  clinicName,
  staffLabel,
  clinicLogoUrl,
  notificationCount,
}: DashboardShellProps) {
  const sidebarTitle = clinicName || title;
  const [mobileOpen, setMobileOpen] = useState(false);
  const router = useRouter();

  async function handleSignOut() {
    await logoutFromCurrentPortal(router);
  }

  return (
    <div className="flex min-h-screen bg-surface">
      <Sidebar
        items={navItems}
        onSignOut={handleSignOut}
        clinicName={sidebarTitle}
        staffName={title}
        staffLabel={staffLabel}
        clinicLogoUrl={clinicLogoUrl}
      />

      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-slate-text/40 lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}
      <div
        className={`fixed inset-y-0 right-0 z-50 w-64 transform transition-transform lg:hidden ${
          mobileOpen ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <Sidebar
          items={navItems}
          onSignOut={handleSignOut}
          clinicName={sidebarTitle}
          staffName={title}
          staffLabel={staffLabel}
          clinicLogoUrl={clinicLogoUrl}
        />
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <Header
          title={title}
          subtitle={subtitle}
          onMenuClick={() => setMobileOpen(true)}
          notificationCount={notificationCount}
        />
        <main className="flex-1 p-4 sm:p-6">{children}</main>
      </div>
    </div>
  );
}
