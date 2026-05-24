import { DashboardLayoutClient } from "@/components/layout/DashboardLayoutClient";
import { AppProviders } from "@/components/providers/AppProviders";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AppProviders>
      <DashboardLayoutClient>{children}</DashboardLayoutClient>
    </AppProviders>
  );
}
