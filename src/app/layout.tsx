import type { Metadata, Viewport } from "next";
import { Noto_Sans_Arabic } from "next/font/google";
import "./globals.css";
import { APP_NAME, APP_NAME_EN, DEVELOPER } from "@/lib/constants";
import { ServiceWorkerRegister } from "@/components/pwa/ServiceWorkerRegister";
import { OfflineToast } from "@/components/pwa/OfflineToast";
import { LanguageProvider } from "@/contexts/LanguageContext";

const notoArabic = Noto_Sans_Arabic({
  subsets: ["arabic"],
  variable: "--font-noto-arabic",
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: {
    default: APP_NAME,
    template: `%s | ${APP_NAME}`,
  },
  description: "نظام إدارة عيادات متعدد المستأجرين — بيرل كلينك",
  applicationName: APP_NAME_EN,
  authors: [{ name: DEVELOPER.nameEn }],
  creator: DEVELOPER.nameEn,
  manifest: "/manifest.json",
  icons: {
    icon: [
      { url: "/icons/pearl-48.png", sizes: "48x48", type: "image/png" },
      { url: "/icons/pearl-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/pearl-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/icons/pearl-180.png", sizes: "180x180", type: "image/png" }],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: APP_NAME_EN,
  },
  formatDetection: {
    telephone: false,
  },
  other: {
    "mobile-web-app-capable": "yes",
    "apple-mobile-web-app-capable": "yes",
    "apple-mobile-web-app-title": APP_NAME_EN,
    "apple-mobile-web-app-status-bar-style": "black-translucent",
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

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ar" dir="rtl" suppressHydrationWarning className={notoArabic.variable}>
      <body className="min-h-screen">
        <LanguageProvider>
          {children}
          <OfflineToast />
          <ServiceWorkerRegister />
        </LanguageProvider>
      </body>
    </html>
  );
}
