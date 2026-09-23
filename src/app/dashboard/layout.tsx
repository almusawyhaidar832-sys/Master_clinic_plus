import type { Metadata, Viewport } from "next";
import { DashboardLayoutClient } from "@/components/layout/DashboardLayoutClient";
import { AppProviders } from "@/components/providers/AppProviders";
import { AccountantPwaBootstrap } from "@/components/pwa/AccountantPwaBootstrap";

export const metadata: Metadata = {
  title: "Accountant | Master Clinic Plus",
  applicationName: "Master Clinic Accountant",
  manifest: "/manifest-accountant.json",
  icons: {
    icon: [{ url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }],
    apple: [{ url: "/icons/icon-192.png", sizes: "180x180", type: "image/png" }],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Master Clinic Accountant",
  },
  other: {
    "mobile-web-app-capable": "yes",
    "apple-mobile-web-app-capable": "yes",
    "apple-mobile-web-app-title": "Master Clinic Accountant",
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

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AppProviders>
      <AccountantPwaBootstrap />
      <DashboardLayoutClient>{children}</DashboardLayoutClient>
    </AppProviders>
  );
}
