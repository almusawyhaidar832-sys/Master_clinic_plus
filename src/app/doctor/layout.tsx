import type { Metadata, Viewport } from "next";
import { DoctorMobileShell } from "@/components/layout/DoctorMobileShell";
import { AppProviders } from "@/components/providers/AppProviders";

export const metadata: Metadata = {
  title: "Doctor App | Master Clinic Plus",
  applicationName: "Master Clinic Doctor",
  manifest: "/manifest.json",
  icons: {
    icon: [{ url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }],
    apple: [{ url: "/icons/icon-192.png", sizes: "180x180", type: "image/png" }],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Master Clinic Doctor",
  },
  other: {
    "mobile-web-app-capable": "yes",
    "apple-mobile-web-app-capable": "yes",
    "apple-mobile-web-app-title": "Master Clinic Doctor",
  },
};

export const viewport: Viewport = {
  themeColor: "#0056b3",
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
  viewportFit: "cover",
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
