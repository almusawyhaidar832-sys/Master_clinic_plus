import type { Metadata, Viewport } from "next";
import { AdminLayoutClient } from "@/components/layout/AdminLayoutClient";
import { AppProviders } from "@/components/providers/AppProviders";

export const metadata: Metadata = {
  title: "Owner | Master Clinic Plus",
  applicationName: "Master Clinic Owner",
  icons: {
    icon: [{ url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }],
    apple: [{ url: "/icons/icon-192.png", sizes: "180x180", type: "image/png" }],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Master Clinic Owner",
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
