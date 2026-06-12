import type { Metadata, Viewport } from "next";
import { Noto_Sans_Arabic } from "next/font/google";
import "./globals.css";
import { APP_NAME, DEVELOPER } from "@/lib/constants";
import { PWAProvider } from "@/components/pwa/PWAProvider";
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
  description: "نظام إدارة عيادات متعدد المستأجرين — ماستر كلينك بلس",
  authors: [{ name: DEVELOPER.nameEn }],
  creator: DEVELOPER.nameEn,
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: APP_NAME,
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
          <PWAProvider />
        </LanguageProvider>
      </body>
    </html>
  );
}
