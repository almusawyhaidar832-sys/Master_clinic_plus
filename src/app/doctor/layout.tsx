import { DoctorMobileShell } from "@/components/layout/DoctorMobileShell";
import { PWARegister } from "@/components/doctor/PWARegister";
import { AppProviders } from "@/components/providers/AppProviders";

export const metadata = {
  title: "تطبيق الطبيب",
};

export default function DoctorLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AppProviders>
      <PWARegister />
      <DoctorMobileShell>{children}</DoctorMobileShell>
    </AppProviders>
  );
}
