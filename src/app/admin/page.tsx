"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { PageHeader } from "@/components/ui/PageHeader";
import { createClient } from "@/lib/supabase/client";
import { getAuthProfile, getActiveClinicId } from "@/lib/clinic-context";
import { fetchDoctorLedgers } from "@/lib/services/clinic-reports";
import { fetchClinicProfitStatsForPeriodViaApi } from "@/lib/services/clinic-stats-api";
import type { ClinicProfitStats } from "@/lib/services/clinic-stats";
import { currentMonthYear, formatCurrency, monthDateRange } from "@/lib/utils";
import {
  FileText,
  Stethoscope,
  Wallet,
  TrendingUp,
  ChevronLeft,
  Activity,
  Crown,
  Calendar,
  History,
} from "lucide-react";
import { ActivityFeed } from "@/components/admin/ActivityFeed";
import { AdminDoctorPerformance } from "@/components/admin/AdminDoctorPerformance";
import { BalanceTopUpButton } from "@/components/finance/BalanceTopUpModal";
import { ProfitExplanationButton } from "@/components/finance/ProfitExplanationModal";

export default function AdminHomePage() {
  const [stats, setStats] = useState<ClinicProfitStats | null>(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [doctorCount, setDoctorCount] = useState(0);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const profile = await getAuthProfile(supabase);
      setIsSuperAdmin(profile?.role === "super_admin");
      const active = await getActiveClinicId(supabase);
      const clinicId = active?.clinicId;
      const [profit, doctors, pending] = await Promise.all([
        (async () => {
          const { from, to } = monthDateRange(currentMonthYear());
          return fetchClinicProfitStatsForPeriodViaApi(from, to, "admin");
        })(),
        fetchDoctorLedgers(supabase),
        clinicId
          ? supabase
              .from("doctor_withdrawals")
              .select("*", { count: "exact", head: true })
              .eq("clinic_id", clinicId)
              .eq("status", "pending")
          : Promise.resolve({ count: 0 }),
      ]);
      setStats(profit);
      setDoctorCount(doctors.length);
      setPendingCount(pending.count ?? 0);
    }
    load();
  }, [refreshKey]);

  const reloadStats = () => setRefreshKey((k) => k + 1);

  const monthRange = monthDateRange(currentMonthYear());

  return (
    <div className="space-y-5 animate-fade-in">
      <PageHeader
        title="لوحة المالك"
        subtitle="متابعة مالية كاملة من الجوال"
        actions={
          <div className="flex items-center gap-2">
            <BalanceTopUpButton portal="admin" onSuccess={reloadStats} size="sm" />
            <span className="mc-badge-premium">
              <Crown className="h-3 w-3" />
              المالك
            </span>
          </div>
        }
      />

      {stats && (
        <div className="relative overflow-hidden rounded-mc-2xl bg-mc-navy p-5 text-white shadow-premium">
          <div className="pointer-events-none absolute -end-10 -top-14 h-48 w-48 rounded-full bg-white/5 blur-2xl" />
          <div className="pointer-events-none absolute -start-8 bottom-[-3rem] h-40 w-40 rounded-full bg-premium-400/10 blur-2xl" />
          <div className="relative flex items-start justify-between gap-3">
            <div>
              <p className="text-xs text-white/70">صافي ربح العيادة (هذا الشهر)</p>
              <p className="mt-1 text-3xl font-extrabold tracking-tight tabular-nums">
                {formatCurrency(stats.netProfit)}
              </p>
              <p className="mt-2 text-xs text-white/70">
                تدفق نقدي: {formatCurrency(stats.cashInflow)}
              </p>
            </div>
            <ProfitExplanationButton
              from={monthRange.from}
              to={monthRange.to}
              portal="admin"
              netProfit={stats.netProfit}
              size="sm"
              variant="outline"
              className="shrink-0 border-white/30 bg-white/10 text-white hover:bg-white/20"
              label="توضيح"
            />
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <Link href="/admin/daily-collections">
          <Card hoverable className="p-3 active:scale-[0.98]">
            <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
              <Calendar className="h-5 w-5 text-primary" />
            </div>
            <p className="text-xs font-semibold text-slate-text">كشف مالي</p>
            <p className="text-[10px] text-slate-muted">مدفوعات وحصص الأطباء</p>
          </Card>
        </Link>
        <Link href="/admin/profits">
          <Card hoverable className="p-3 active:scale-[0.98]">
            <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
              <TrendingUp className="h-5 w-5 text-primary" />
            </div>
            <p className="text-xs font-semibold text-slate-text">الأرباح</p>
            <p className="text-[10px] text-slate-muted">تفصيل كامل</p>
          </Card>
        </Link>
        <Link href="/admin/financial-history">
          <Card hoverable className="p-3 active:scale-[0.98]">
            <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-lg bg-violet-100">
              <History className="h-5 w-5 text-violet-700" />
            </div>
            <p className="text-xs font-semibold text-slate-text">سجل الصرفيات</p>
            <p className="text-[10px] text-slate-muted">أرشيف كامل للإدارة</p>
          </Card>
        </Link>
        <Link href="/admin/withdrawals">
          <Card hoverable className="p-3 active:scale-[0.98]">
            <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
              <Wallet className="h-5 w-5 text-primary" />
            </div>
            <p className="text-xs font-semibold text-slate-text">طلبات السحب</p>
            <p className="text-[10px] text-slate-muted">
              {pendingCount > 0 ? (
                <Badge variant="warning">{pendingCount} معلّق</Badge>
              ) : (
                "لا طلبات معلّقة"
              )}
            </p>
          </Card>
        </Link>
        <Link href="/admin/doctors">
          <Card hoverable className="p-3 active:scale-[0.98]">
            <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
              <Stethoscope className="h-5 w-5 text-primary" />
            </div>
            <p className="text-xs font-semibold text-slate-text">حسابات الأطباء</p>
            <p className="text-[10px] text-slate-muted">{doctorCount} طبيب</p>
          </Card>
        </Link>
        <Link href="/admin/report">
          <Card hoverable premium className="p-3 active:scale-[0.98]">
            <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-lg bg-premium-50 text-premium-600">
              <FileText className="h-5 w-5" />
            </div>
            <p className="text-xs font-semibold text-slate-text">التقرير الشامل</p>
            <p className="text-[10px] text-premium-600">طباعة / مشاركة</p>
          </Card>
        </Link>
      </div>

      <AdminDoctorPerformance />

      <Card className="p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
              <Activity className="h-5 w-5 text-primary" />
            </div>
            <p className="text-sm font-bold text-slate-text">موجز العمليات</p>
          </div>
          <Link
            href="/admin/activity"
            className="text-xs font-semibold text-primary"
          >
            السجل الكامل ←
          </Link>
        </div>
        <ActivityFeed authPortal="admin" compact maxItems={5} pollMs={30_000} />
      </Card>

      <Link href="/admin/report">
        <Button className="w-full" size="lg" variant="premium">
          <FileText className="h-5 w-5" />
          إنشاء التقرير المالي الشامل
        </Button>
      </Link>

      <Link
        href="/admin/doctors"
        className="mc-hover-lift group flex items-center justify-between rounded-xl border border-slate-border bg-surface-card p-4 text-sm"
      >
        <span>عرض دفاتر الأطباء المالية</span>
        <ChevronLeft className="h-4 w-4 text-slate-muted transition-transform group-hover:-translate-x-0.5" />
      </Link>

      <Link
        href="/dashboard/settings"
        className="mc-hover-lift group flex items-center justify-between rounded-xl border border-slate-border bg-surface-card p-4 text-sm"
      >
        <span>تعديل ملف العيادة (اسم، شعار، عنوان)</span>
        <ChevronLeft className="h-4 w-4 text-slate-muted transition-transform group-hover:-translate-x-0.5" />
      </Link>

      {isSuperAdmin && (
        <Link
          href="/admin/clinics"
          className="flex items-center justify-between rounded-xl border border-dashed border-slate-border bg-surface p-4 text-sm text-slate-muted"
        >
          <span>إدارة عيادات المنصة (متعدد المستأجرين)</span>
          <ChevronLeft className="h-4 w-4" />
        </Link>
      )}
    </div>
  );
}
