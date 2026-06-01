"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { getDoctorForCurrentUser } from "@/lib/clinic-context";
import { getCurrentUser } from "@/lib/supabase/auth-helpers";
import { fetchDoctorWalletStats } from "@/lib/services/doctor-wallet";
import { fetchUnreadNotificationCount } from "@/lib/services/clinic-stats";
import { formatCurrency, todayISO } from "@/lib/utils";
import { doctorQuickActions } from "@/components/layout/DoctorMobileShell";
import { cn } from "@/lib/utils";
import { Bell, TrendingUp, Wallet, ArrowDownToLine } from "lucide-react";

export function DoctorHomeDashboard() {
  const [wallet, setWallet] = useState<{
    availableBalance: number;
    totalEarnings: number;
    totalWithdrawn: number;
    pendingAmount: number;
  } | null>(null);
  const [todayOps, setTodayOps] = useState(0);
  const [notifications, setNotifications] = useState(0);
  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const user = await getCurrentUser(supabase);
      if (!user) return;

      const doctor = await getDoctorForCurrentUser(supabase);
      if (!doctor) return;

      const [stats, opsRes, notifCount] = await Promise.all([
        fetchDoctorWalletStats(supabase, doctor.id),
        supabase
          .from("patient_operations")
          .select("id", { count: "exact", head: true })
          .eq("doctor_id", doctor.id)
          .eq("operation_date", todayISO()),
        fetchUnreadNotificationCount(supabase, user.id),
      ]);

      setWallet(stats);
      setTodayOps(opsRes.count ?? 0);
      setNotifications(notifCount);
    }
    load();
  }, []);

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="rounded-2xl bg-gradient-to-br from-primary to-primary-700 p-5 text-white shadow-premium">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs opacity-90">رصيدك الحالي</p>
            <p className="mt-1 text-3xl font-bold">
              {wallet ? formatCurrency(wallet.availableBalance) : "…"}
            </p>
          </div>
          <Wallet className="h-8 w-8 opacity-80" />
        </div>
        <div className="mt-4 grid grid-cols-3 gap-2 text-center text-[10px]">
          <div className="rounded-lg bg-white/10 p-2">
            <p className="opacity-80">الأرباح</p>
            <p className="font-semibold">
              {wallet ? formatCurrency(wallet.totalEarnings) : "—"}
            </p>
          </div>
          <div className="rounded-lg bg-white/10 p-2">
            <p className="opacity-80">مسحوب</p>
            <p className="font-semibold">
              {wallet ? formatCurrency(wallet.totalWithdrawn) : "—"}
            </p>
          </div>
          <div className="rounded-lg bg-white/10 p-2">
            <p className="opacity-80">معلّق</p>
            <p className="font-semibold">
              {wallet ? formatCurrency(wallet.pendingAmount) : "—"}
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Link
          href="/doctor/withdraw"
          className="flex items-center gap-3 rounded-xl border border-primary/30 bg-primary/5 p-3 transition active:scale-[0.98]"
        >
          <ArrowDownToLine className="h-5 w-5 text-primary" />
          <span className="text-sm font-semibold text-slate-text">طلب سحب</span>
        </Link>
        <Link
          href="/doctor/wallet"
          className="flex items-center gap-3 rounded-xl border border-slate-border bg-surface-card p-3 transition active:scale-[0.98]"
        >
          <TrendingUp className="h-5 w-5 text-primary" />
          <span className="text-sm font-semibold text-slate-text">تفاصيل المحفظة</span>
        </Link>
      </div>

      <div className="flex gap-3 text-sm">
        <div className="flex-1 rounded-xl border border-slate-border bg-surface-card p-3 text-center">
          <p className="text-2xl font-bold text-primary">{todayOps}</p>
          <p className="text-xs text-slate-muted">عمليات اليوم</p>
        </div>
        <Link
          href="/doctor/notifications"
          className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-slate-border bg-surface-card p-3"
        >
          <Bell className="h-5 w-5 text-primary" />
          <span className="font-semibold">{notifications}</span>
          <span className="text-xs text-slate-muted">إشعار</span>
        </Link>
      </div>

      <p className="text-sm text-slate-muted">المهام</p>
      <div className="grid gap-3">
        {doctorQuickActions.map(({ href, label, icon: Icon, desc }) => (
          <Link
            key={href}
            href={href}
            className={cn(
              "flex items-center gap-4 rounded-xl border border-slate-border bg-surface-card p-4 shadow-card transition-shadow active:scale-[0.98]"
            )}
          >
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Icon className="h-6 w-6" />
            </div>
            <div>
              <p className="font-semibold text-slate-text">{label}</p>
              <p className="text-xs text-slate-muted">{desc}</p>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
