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
    <div className="min-h-screen bg-slate-950 text-slate-100" dir="rtl">
      {children}
    </div>
  );
}
