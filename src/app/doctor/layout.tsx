import { DoctorMobileShell } from "@/components/layout/DoctorMobileShell";
import { AppProviders } from "@/components/providers/AppProviders";

export const metadata = {
  title: "Doctor App | Master Clinic Plus",
};

export default function DoctorLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AppProviders>
      <DoctorMobileShell>{children}</DoctorMobileShell>
    </AppProviders>
  );
}
