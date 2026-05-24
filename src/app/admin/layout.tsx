import { AdminLayoutClient } from "@/components/layout/AdminLayoutClient";
import { AppProviders } from "@/components/providers/AppProviders";

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AppProviders>
      <AdminLayoutClient>{children}</AdminLayoutClient>
    </AppProviders>
  );
}
