import type { Metadata, Viewport } from "next";
import { DoctorMobileShell } from "@/components/layout/DoctorMobileShell";
import { AppProviders } from "@/components/providers/AppProviders";
import { DoctorPwaBootstrap } from "@/components/pwa/DoctorPwaBootstrap";

export const metadata: Metadata = {
  title: "Doctor App | Pearl System",
  applicationName: "Pearl System Doctor",
  manifest: "/manifest-doctor.json",
  icons: {
    icon: [{ url: "/icons/pearl-192.png", sizes: "192x192", type: "image/png" }],
    apple: [{ url: "/icons/pearl-192.png", sizes: "180x180", type: "image/png" }],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Pearl System Doctor",
  },
  other: {
    "mobile-web-app-capable": "yes",
    "apple-mobile-web-app-capable": "yes",
    "apple-mobile-web-app-title": "Pearl System Doctor",
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
      <DoctorPwaBootstrap />
      <DoctorMobileShell>{children}</DoctorMobileShell>
    </AppProviders>
  );
}
