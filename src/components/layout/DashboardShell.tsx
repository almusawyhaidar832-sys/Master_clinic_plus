"use client";

import { useState } from "react";
import { Sidebar } from "./Sidebar";
import { Header } from "./Header";
import type { NavItem } from "@/types";
import { createClient } from "@/lib/supabase/client";
import { signOutUser } from "@/lib/supabase/auth-helpers";
import { useRouter } from "next/navigation";

interface DashboardShellProps {
  children: React.ReactNode;
  navItems: NavItem[];
  title: string;
  subtitle?: string;
  clinicLogoUrl?: string | null;
  notificationCount?: number;
}

export function DashboardShell({
  children,
  navItems,
  title,
  subtitle,
  clinicLogoUrl,
  notificationCount,
}: DashboardShellProps) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const router = useRouter();

  async function handleSignOut() {
    const supabase = createClient();
    await signOutUser(supabase);
    router.push("/login");
    router.refresh();
  }

  return (
    <div className="flex min-h-screen bg-surface">
      <Sidebar
        items={navItems}
        onSignOut={handleSignOut}
        clinicName={title}
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
        clinicName={title}
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
