import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "المدير العام",
  robots: { index: false, follow: false },
};

export default function DeveloperLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div
      className="min-h-dvh overflow-y-auto overscroll-y-contain bg-slate-950 text-slate-100"
      dir="rtl"
    >
      {children}
    </div>
  );
}
