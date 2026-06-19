"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
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
} from "lucide-react";
import { ActivityFeed } from "@/components/admin/ActivityFeed";
import { AdminDoctorPerformance } from "@/components/admin/AdminDoctorPerformance";

export default function AdminHomePage() {
  const [stats, setStats] = useState<ClinicProfitStats | null>(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [doctorCount, setDoctorCount] = useState(0);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);

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
  }, []);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-bold text-slate-text">لوحة المالك</h2>
        <p className="text-sm text-slate-muted">متابعة مالية كاملة من الجوال</p>
      </div>

      {stats && (
        <div className="rounded-2xl bg-gradient-to-br from-primary to-primary-700 p-5 text-white shadow-premium">
          <p className="text-xs opacity-90">صافي ربح العيادة (هذا الشهر)</p>
          <p className="mt-1 text-3xl font-bold tabular-nums">
            {formatCurrency(stats.netProfit)}
          </p>
          <p className="mt-2 text-xs opacity-80">
            تدفق نقدي: {formatCurrency(stats.cashInflow)}
          </p>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <Link href="/admin/profits">
          <Card className="p-3 active:scale-[0.98]">
            <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
              <TrendingUp className="h-5 w-5 text-primary" />
            </div>
            <p className="text-xs font-semibold text-slate-text">الأرباح</p>
            <p className="text-[10px] text-slate-muted">تفصيل كامل</p>
          </Card>
        </Link>
        <Link href="/admin/withdrawals">
          <Card className="p-3 active:scale-[0.98]">
            <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
              <Wallet className="h-5 w-5 text-primary" />
            </div>
            <p className="text-xs font-semibold text-slate-text">طلبات السحب</p>
            <p className="text-[10px] text-primary">
              {pendingCount} معلّق
            </p>
          </Card>
        </Link>
        <Link href="/admin/doctors">
          <Card className="p-3 active:scale-[0.98]">
            <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
              <Stethoscope className="h-5 w-5 text-primary" />
            </div>
            <p className="text-xs font-semibold text-slate-text">حسابات الأطباء</p>
            <p className="text-[10px] text-slate-muted">{doctorCount} طبيب</p>
          </Card>
        </Link>
        <Link href="/admin/report">
          <Card className="p-3 active:scale-[0.98] ring-1 ring-primary/20">
            <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
              <FileText className="h-5 w-5 text-primary" />
            </div>
            <p className="text-xs font-semibold text-slate-text">التقرير الشامل</p>
            <p className="text-[10px] text-primary">طباعة / مشاركة</p>
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
        <Button className="w-full" size="lg">
          <FileText className="h-5 w-5" />
          إنشاء التقرير المالي الشامل
        </Button>
      </Link>

      <Link
        href="/admin/doctors"
        className="flex items-center justify-between rounded-xl border border-slate-border bg-surface-card p-4 text-sm"
      >
        <span>عرض دفاتر الأطباء المالية</span>
        <ChevronLeft className="h-4 w-4 text-slate-muted" />
      </Link>

      <Link
        href="/dashboard/settings"
        className="flex items-center justify-between rounded-xl border border-slate-border bg-surface-card p-4 text-sm"
      >
        <span>تعديل ملف العيادة (اسم، شعار، عنوان)</span>
        <ChevronLeft className="h-4 w-4 text-slate-muted" />
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
