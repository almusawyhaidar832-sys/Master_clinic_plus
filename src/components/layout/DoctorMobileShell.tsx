"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { useClinicProfile } from "@/contexts/ClinicProfileContext";
import {
  Wallet,
  ArrowDownToLine,
  Users,
  Calendar,
  CalendarClock,
  AlertCircle,
  FileText,
  Home,
} from "lucide-react";

const doctorNav = [
  { href: "/doctor", label: "الرئيسية", icon: Home },
  { href: "/doctor/wallet", label: "المحفظة", icon: Wallet },
  { href: "/doctor/patients", label: "المرضى", icon: Users },
  { href: "/doctor/schedule", label: "المواعيد", icon: CalendarClock },
];

export function DoctorMobileShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { displayName, profile } = useClinicProfile();

  return (
    <div className="flex min-h-screen flex-col bg-surface pb-20">
      <header className="safe-top sticky top-0 z-30 bg-primary px-4 py-4 text-white shadow-premium">
        <div className="flex items-center gap-2">
          {profile?.logo_url && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={profile.logo_url}
              alt=""
              className="h-8 w-8 rounded-lg border border-white/20 bg-white object-contain p-0.5"
            />
          )}
          <div>
            <p className="text-xs opacity-90">تطبيق الطبيب — {displayName}</p>
            <h1 className="text-lg font-bold">{displayName}</h1>
          </div>
        </div>
      </header>

      <main className="flex-1 px-4 py-4">{children}</main>

      <nav className="safe-bottom fixed bottom-0 left-0 right-0 z-40 border-t border-slate-border bg-surface-card px-2 py-2">
        <div className="flex justify-around">
          {doctorNav.map(({ href, label, icon: Icon }) => {
            const active = pathname === href;
            return (
              <Link
                key={href}
                href={href}
                className={cn(
                  "flex flex-col items-center gap-0.5 rounded-lg px-3 py-1.5 text-[10px] font-medium transition-colors",
                  active ? "text-primary" : "text-slate-muted"
                )}
              >
                <Icon className="h-5 w-5" />
                {label}
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}

export const doctorQuickActions = [
  { href: "/doctor/wallet", label: "المحفظة", icon: Wallet, desc: "الرصيد القابل للسحب" },
  { href: "/doctor/withdraw", label: "طلب سحب", icon: ArrowDownToLine, desc: "إشعار فوري للمحاسب" },
  { href: "/doctor/patients", label: "رعاية المرضى", icon: Users, desc: "السجل الطبي والمالي" },
  { href: "/doctor/filter", label: "تصفية بالتاريخ", icon: Calendar, desc: "يوم أو فترة مخصصة" },
  { href: "/doctor/schedule", label: "إدارة المواعيد", icon: CalendarClock, desc: "حجز وقفل الساعات" },
  { href: "/doctor/incomplete", label: "علاجات غير مكتملة", icon: AlertCircle, desc: "لا تُنسى أبداً" },
  { href: "/doctor/statement", label: "كشف حساب مريض", icon: FileText, desc: "طباعة ومشاركة" },
];
