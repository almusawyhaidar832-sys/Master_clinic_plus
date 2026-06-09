import { AppointmentsNavTabs } from "@/components/appointments/AppointmentsNavTabs";

export default function AppointmentsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4 sm:p-6">
      <AppointmentsNavTabs />
      {children}
    </div>
  );
}
