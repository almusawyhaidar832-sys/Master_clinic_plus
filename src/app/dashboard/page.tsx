import Link from "next/link";
import { Card, CardTitle } from "@/components/ui/Card";
import { DashboardTodaySummary } from "@/components/accountant/DashboardTodaySummary";
import { Users, Stethoscope, Wallet, Receipt, FileText } from "lucide-react";

const quickLinks = [
  {
    href: "/dashboard/ledger",
    title: "إدخال عملية جديدة",
    desc: "سجل مريض — حساب المتبقي تلقائياً",
    icon: Users,
    color: "bg-primary/10 text-primary",
  },
  {
    href: "/dashboard/doctors/new",
    title: "إضافة طبيب",
    desc: "اتفاقيات مالية من قوائم ثابتة",
    icon: Stethoscope,
    color: "bg-blue-50 text-blue-600",
  },
  {
    href: "/dashboard/withdrawals",
    title: "طلبات السحب",
    desc: "إشعارات الأطباء الفورية",
    icon: Wallet,
    color: "bg-amber-50 text-amber-600",
  },
  {
    href: "/dashboard/expenses",
    title: "المصروفات والرواتب",
    desc: "مصروفات حرة + 7 موظفين",
    icon: Receipt,
    color: "bg-purple-50 text-purple-600",
  },
  {
    href: "/dashboard/reports",
    title: "تقرير للمالك",
    desc: "تقرير شامل بنقرة واحدة",
    icon: FileText,
    color: "bg-teal-50 text-teal-700",
  },
];

export default function DashboardPage() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-slate-text">مرحباً بك</h2>
        <p className="text-slate-muted">لوحة المحاسب — إدارة العيادة اليومية</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
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

      <DashboardTodaySummary />
    </div>
  );
}
