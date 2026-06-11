import Link from "next/link";
import { Card, CardTitle } from "@/components/ui/Card";
import { ExecutiveDashboard } from "@/components/accountant/ExecutiveDashboard";
import { AccountantAppointmentsPanel } from "@/components/appointments/AccountantAppointmentsPanel";
import {
  Users, Stethoscope, Wallet, Receipt,
  FileText, ListOrdered, QrCode, CalendarClock,
} from "lucide-react";

const quickLinks = [
  {
    href: "/dashboard/ledger",
    title: "إدخال عملية جديدة",
    desc: "سجل مريض — حساب المتبقي تلقائياً",
    icon: Users,
    color: "mc-icon-badge-primary",
  },
  {
    href: "/dashboard/queue",
    title: "غرفة الانتظار",
    desc: "نداء صوتي — تتبع حي للمرضى",
    icon: ListOrdered,
    color: "mc-icon-badge-warning",
  },
  {
    href: "/dashboard/appointments",
    title: "الحجوزات",
    desc: "حجز فوري + جدول المواعيد لكل الأطباء",
    icon: CalendarClock,
    color: "mc-icon-badge-soft",
  },
  {
    href: "/dashboard/withdrawals",
    title: "طلبات السحب",
    desc: "إشعارات الأطباء الفورية",
    icon: Wallet,
    color: "mc-icon-badge-primary",
  },
  {
    href: "/dashboard/doctor-expenses",
    title: "صرفيات عامة",
    desc: "صرفيات العيادة + رواتب الأطباء + مصروفات",
    icon: Receipt,
    color: "mc-icon-badge-soft",
  },
  {
    href: "/dashboard/doctors",
    title: "إدارة الأطباء",
    desc: "المحافظ والحصص واتفاقيات مالية",
    icon: Stethoscope,
    color: "mc-icon-badge-primary",
  },
  {
    href: "/dashboard/reports",
    title: "تقرير للمالك",
    desc: "تقرير شامل بنقرة واحدة",
    icon: FileText,
    color: "mc-icon-badge-soft",
  },
  {
    href: "/dashboard/booking",
    title: "باركود الحجوزات",
    desc: "عرض وتحميل باركود عيادتك للمرضى",
    icon: QrCode,
    color: "mc-icon-badge-success",
  },
];

export default function DashboardPage() {
  return (
    <div className="space-y-8">

      {/* Quick actions */}
      <div>
        <h2 className="mb-4 text-lg font-bold text-primary-700">الإجراءات السريعة</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {quickLinks.map(({ href, title, desc, icon: Icon, color }) => (
            <Link key={href} href={href}>
              <Card className="h-full cursor-pointer transition-shadow hover:shadow-premium">
                <div className={`mb-3 inline-flex rounded-lg p-2.5 ${color}`}>
                  <Icon className="h-5 w-5" />
                </div>
                <CardTitle className="text-base">{title}</CardTitle>
                <p className="mt-1 text-sm text-slate-muted">{desc}</p>
              </Card>
            </Link>
          ))}
        </div>
      </div>

      {/* Executive Dashboard — the killer feature */}
      <ExecutiveDashboard />

      {/* معاينة الحجوزات — الصفحة الكاملة في /dashboard/appointments */}
      <AccountantAppointmentsPanel />
    </div>
  );
}
