"use client";

import Link from "next/link";
import { ExecutiveDashboard } from "@/components/accountant/ExecutiveDashboard.lazy";
import { AccountantAppointmentsPanel } from "@/components/appointments/AccountantAppointmentsPanel";
import { useLanguage } from "@/contexts/LanguageContext";
import {
  Users, Stethoscope, Wallet, Receipt,
  FileText, ListOrdered, QrCode, CalendarClock,
  ChevronLeft, CalendarDays,
} from "lucide-react";

export function DashboardHomeContent() {
  const { t } = useLanguage();

  const quickLinks = [
    {
      href: "/dashboard/ledger",
      title: t("qlLedgerTitle"),
      desc: t("qlLedgerDesc"),
      icon: Users,
      color: "mc-icon-badge-primary",
    },
    {
      href: "/dashboard/daily-collections",
      title: t("qlDailyCollectionsTitle"),
      desc: t("qlDailyCollectionsDesc"),
      icon: CalendarDays,
      color: "mc-icon-badge-success",
    },
    {
      href: "/dashboard/queue",
      title: t("qlQueueTitle"),
      desc: t("qlQueueDesc"),
      icon: ListOrdered,
      color: "mc-icon-badge-warning",
    },
    {
      href: "/dashboard/appointments",
      title: t("qlAppointmentsTitle"),
      desc: t("qlAppointmentsDesc"),
      icon: CalendarClock,
      color: "mc-icon-badge-soft",
    },
    {
      href: "/dashboard/withdrawals",
      title: t("qlWithdrawalsTitle"),
      desc: t("qlWithdrawalsDesc"),
      icon: Wallet,
      color: "mc-icon-badge-primary",
    },
    {
      href: "/dashboard/doctor-expenses",
      title: t("qlExpensesTitle"),
      desc: t("qlExpensesDesc"),
      icon: Receipt,
      color: "mc-icon-badge-soft",
    },
    {
      href: "/dashboard/doctors",
      title: t("qlDoctorsTitle"),
      desc: t("qlDoctorsDesc"),
      icon: Stethoscope,
      color: "mc-icon-badge-primary",
    },
    {
      href: "/dashboard/reports",
      title: t("qlReportsTitle"),
      desc: t("qlReportsDesc"),
      icon: FileText,
      color: "mc-icon-badge-soft",
    },
    {
      href: "/dashboard/booking",
      title: t("qlBookingTitle"),
      desc: t("qlBookingDesc"),
      icon: QrCode,
      color: "mc-icon-badge-success",
    },
  ];

  const heroHrefs = ["/dashboard/ledger", "/dashboard/queue", "/dashboard/appointments"];
  const heroShortcuts = heroHrefs
    .map((href) => quickLinks.find((l) => l.href === href))
    .filter((l): l is (typeof quickLinks)[number] => !!l);
  const rest = quickLinks.filter((l) => !heroHrefs.includes(l.href));

  return (
    <div className="space-y-8 animate-fade-in">
      <section className="mc-hero rounded-[28px] p-6 sm:p-8">
        <div className="pointer-events-none absolute -end-16 -top-24 h-72 w-72 rounded-full border border-white/[0.06]" />
        <div className="pointer-events-none absolute -end-4 -top-10 h-44 w-44 rounded-full border border-white/[0.08]" />

        <div className="relative flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/icons/pearl-192.png"
              alt=""
              className="h-16 w-16 shrink-0 rounded-[20px] object-cover shadow-[0_14px_30px_-10px_rgba(0,0,0,0.7)] ring-1 ring-white/15 sm:h-[72px] sm:w-[72px]"
            />
            <div className="min-w-0">
              <p className="text-xs font-semibold tracking-[0.2em] text-[#dcc29a]/85">
                {t("welcome")}
              </p>
              <h2 className="no-accent mt-1 text-2xl font-bold leading-tight text-white sm:text-[28px]">
                {t("accHeroTitle")}
              </h2>
              <p className="mt-1 text-sm text-white/60">{t("accHeroSub")}</p>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2.5 sm:gap-3 lg:w-[460px]">
            {heroShortcuts.map(({ href, title, icon: Icon }, i) => (
              <Link
                key={href}
                href={href}
                className={
                  i === 0
                    ? "group flex flex-col items-center gap-2 rounded-2xl bg-mc-pearl px-2 py-3.5 text-center text-[#0b1f3a] shadow-[0_14px_30px_-12px_rgba(220,194,154,0.7)] transition-transform duration-200 hover:-translate-y-0.5"
                    : "group flex flex-col items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.07] px-2 py-3.5 text-center text-white backdrop-blur transition-all duration-200 hover:-translate-y-0.5 hover:bg-white/[0.12]"
                }
              >
                <Icon className={i === 0 ? "h-5 w-5" : "h-5 w-5 text-[#dcc29a]"} />
                <span className="line-clamp-2 text-xs font-bold leading-snug">{title}</span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section>
        <div className="mb-4 flex items-center gap-3">
          <h2 className="no-accent text-base font-bold text-slate-text">{t("quickActionsTitle")}</h2>
          <span className="h-px flex-1 bg-gradient-to-l from-transparent to-slate-border" />
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {rest.map(({ href, title, desc, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className="group relative flex items-center gap-3.5 rounded-2xl border border-slate-border bg-surface-card p-4 shadow-card transition-all duration-300 ease-mc-out hover:-translate-y-0.5 hover:border-premium-300/70 hover:shadow-elevated"
            >
              <span className="mc-icon-tile h-12 w-12 transition-transform duration-300 group-hover:scale-105">
                <Icon className="h-5 w-5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-bold text-slate-text">{title}</span>
                <span className="mt-0.5 line-clamp-2 block text-xs leading-5 text-slate-muted">{desc}</span>
              </span>
              <ChevronLeft className="h-4 w-4 shrink-0 text-slate-muted/40 transition-all group-hover:-translate-x-0.5 group-hover:text-premium-500 ltr:rotate-180" />
            </Link>
          ))}
        </div>
      </section>

      <ExecutiveDashboard />
      <AccountantAppointmentsPanel />
    </div>
  );
}
