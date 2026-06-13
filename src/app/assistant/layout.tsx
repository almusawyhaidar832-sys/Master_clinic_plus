import type { Metadata, Viewport } from "next";
import { AssistantMobileShell } from "@/components/layout/AssistantMobileShell";
import { AppProviders } from "@/components/providers/AppProviders";

export const metadata: Metadata = {
  title: "Assistant App | Master Clinic Plus",
  applicationName: "Master Clinic Assistant",
  manifest: "/manifest-assistant.json",
  icons: {
    icon: [{ url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }],
    apple: [{ url: "/icons/icon-192.png", sizes: "180x180", type: "image/png" }],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Master Clinic Assistant",
  },
  other: {
    "mobile-web-app-capable": "yes",
    "apple-mobile-web-app-capable": "yes",
    "apple-mobile-web-app-title": "Master Clinic Assistant",
  },
};

export const viewport: Viewport = {
  themeColor: "#0d9488",
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
  viewportFit: "cover",
};

export default function AssistantLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AppProviders>
      <AssistantMobileShell>{children}</AssistantMobileShell>
    </AppProviders>
  );
}
