import type { Metadata, Viewport } from "next";
import { DashboardLayoutClient } from "@/components/layout/DashboardLayoutClient";
import { AppProviders } from "@/components/providers/AppProviders";
import { AccountantPwaBootstrap } from "@/components/pwa/AccountantPwaBootstrap";

export const metadata: Metadata = {
  title: "Accountant | Pearl System",
  applicationName: "Pearl System Accountant",
  manifest: "/manifest-accountant.json",
  icons: {
    icon: [{ url: "/icons/pearl-192.png", sizes: "192x192", type: "image/png" }],
    apple: [{ url: "/icons/pearl-192.png", sizes: "180x180", type: "image/png" }],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Pearl System Accountant",
  },
  other: {
    "mobile-web-app-capable": "yes",
    "apple-mobile-web-app-capable": "yes",
    "apple-mobile-web-app-title": "Pearl System Accountant",
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
