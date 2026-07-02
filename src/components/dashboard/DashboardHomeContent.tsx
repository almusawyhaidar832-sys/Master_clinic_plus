"use client";

import Link from "next/link";
import { Card, CardTitle } from "@/components/ui/Card";
import { ExecutiveDashboard } from "@/components/accountant/ExecutiveDashboard";
import { AccountantAppointmentsPanel } from "@/components/appointments/AccountantAppointmentsPanel";
import { useLanguage } from "@/contexts/LanguageContext";
import {
  Users, Stethoscope, Wallet, Receipt,
  FileText, ListOrdered, QrCode, CalendarClock,
  ChevronLeft,
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

  return (
    <div className="space-y-8">
      <div>
        <h2 className="mb-4 text-lg font-bold tracking-tight text-primary-700">
          {t("quickActionsTitle")}
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {quickLinks.map(({ href, title, desc, icon: Icon, color }) => (
            <Link key={href} href={href}>
              <Card hoverable className="group relative h-full cursor-pointer">
                <div className={`mb-3 inline-flex rounded-lg p-2.5 transition-transform duration-200 group-hover:scale-110 ${color}`}>
                  <Icon className="h-5 w-5" />
                </div>
                <CardTitle className="text-base">{title}</CardTitle>
                <p className="mt-1 text-sm text-slate-muted">{desc}</p>
                <ChevronLeft className="absolute end-4 top-6 h-4 w-4 text-slate-muted/40 transition-transform group-hover:-translate-x-0.5" />
              </Card>
            </Link>
          ))}
        </div>
      </div>

      <ExecutiveDashboard />
      <AccountantAppointmentsPanel />
    </div>
  );
}
