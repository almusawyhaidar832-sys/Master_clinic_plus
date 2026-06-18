import type { Metadata, Viewport } from "next";
import { QueueScreenPwaBootstrap } from "@/components/pwa/QueueScreenPwaBootstrap";

export const metadata: Metadata = {
  title: "شاشة انتظار المرضى",
  applicationName: "شاشة الانتظار",
  manifest: "/manifest-queue-screen.json",
  icons: {
    icon: [{ url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }],
    apple: [{ url: "/icons/icon-192.png", sizes: "180x180", type: "image/png" }],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "شاشة الانتظار",
  },
  other: {
    "mobile-web-app-capable": "yes",
    "apple-mobile-web-app-capable": "yes",
    "apple-mobile-web-app-title": "شاشة الانتظار",
  },
};

export const viewport: Viewport = {
  themeColor: "#0f172a",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function QueueScreenLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <QueueScreenPwaBootstrap />
      {children}
    </>
  );
}
