import type { Metadata, Viewport } from "next";

export const metadata: Metadata = {
  title: "حجز موعد",
  description: "احجز موعدك في العيادة عبر الباركود",
  formatDetection: {
    telephone: true,
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  themeColor: "#0f766e",
};

export default function BookingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
