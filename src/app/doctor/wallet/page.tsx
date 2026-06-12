"use client";

import { useCallback, useEffect, useState } from "react";
import { useClinicSync } from "@/hooks/useClinicSync";
import Link from "next/link";
import { formatCurrency } from "@/lib/utils";
import { cacheDoctorBalance, getCachedDoctorBalance } from "@/lib/offline-cache";
import { createClient } from "@/lib/supabase/client";
import { getDoctorForCurrentUser } from "@/lib/clinic-context";
import { isSalaryDoctor } from "@/lib/services/doctor-payment";
import {
  fetchDoctorWalletStats,
  type DoctorWalletStats,
} from "@/lib/services/doctor-wallet";
import { authPortalHeaders } from "@/lib/auth/api-portal";
import { Button } from "@/components/ui/Button";
import { ArrowDownToLine } from "lucide-react";

export default function DoctorWalletPage() {
  const [stats, setStats] = useState<DoctorWalletStats | null>(null);
  const [offline, setOffline] = useState(false);
  const [doctorId, setDoctorId] = useState<string | null>(null);
  const [salaryDoctor, setSalaryDoctor] = useState(false);
  const [zeroHint, setZeroHint] = useState(false);

  const load = useCallback(async () => {
    const supabase = createClient();
    const doctor = await getDoctorForCurrentUser(supabase);

    if (!doctor) {
      setStats({
        availableBalance: 0,
        totalEarnings: 0,
        totalWithdrawn: 0,
        pendingAmount: 0,
        approvedAmount: 0,
        expenseDeductions: 0,
        payrollDeductions: 0,
        withdrawableLimit: 0,
        isDebtor: false,
      });
      return;
    }

    setDoctorId(doctor.id);
    const isSalary = isSalaryDoctor(doctor);
    setSalaryDoctor(isSalary);

    if (!navigator.onLine) {
      setOffline(true);
      const cached = getCachedDoctorBalance(doctor.id) ?? 0;
      setStats({
        availableBalance: cached,
        totalEarnings: 0,
        totalWithdrawn: 0,
        pendingAmount: 0,
        approvedAmount: 0,
        expenseDeductions: 0,
        payrollDeductions: 0,
        withdrawableLimit: Math.max(0, cached),
        isDebtor: cached < 0,
      });
      return;
    }

    let live: DoctorWalletStats | null = null;
    try {
      const res = await fetch("/api/doctor/wallet-stats", {
        credentials: "include",
        headers: authPortalHeaders("doctor"),
      });
      if (res.ok) {
        live = (await res.json()) as DoctorWalletStats;
      }
    } catch {
      /* fallback below */
    }

    if (!live) {
      live = await fetchDoctorWalletStats(supabase, doctor.id);
    }

    setStats(live);
    setZeroHint(!isSalary && live.totalEarnings <= 0);
    cacheDoctorBalance(live.availableBalance, doctor.id);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useClinicSync({
    topics: ["sessions", "refunds", "financial"],
    doctorId,
    onRefresh: load,
    enabled: !!doctorId,
  });

  const rows = [
    {
      label: salaryDoctor ? "صافي الراتب المستحق" : "إجمالي الأرباح",
      value: stats?.totalEarnings,
      highlight: false,
    },
    { label: "صرفيات الطبيب", value: stats?.expenseDeductions, highlight: true },
    {
      label: salaryDoctor ? "الراتب المُصرف" : "المسحوب (مدفوع)",
      value: stats?.totalWithdrawn,
      highlight: false,
    },
    ...(salaryDoctor
      ? []
      : [
          { label: "طلبات معلّقة", value: stats?.pendingAmount, highlight: true },
          {
            label: "موافق عليها (لم تُدفع)",
            value: stats?.approvedAmount,
            highlight: true,
          },
        ]),
  ];

  return (
    <div className="space-y-4">
      {offline && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
          وضع عدم الاتصال — عرض آخر رصيد محفوظ
        </p>
      )}
      {!doctorId && stats?.availableBalance === 0 && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
          لم يُربط حسابك بسجل طبيب. تواصل مع الإدارة.
        </p>
      )}
      {doctorId && zeroHint && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 leading-relaxed">
          الرصيد يُحسب من <strong>المبلغ المدفوع</strong> في الإدخال السريع — إذا
          سجّلت الحالة بدون دفعة يبقى الرصيد صفر. تأكد أن المحاسب اختار طبيبك
          وسجّل مبلغ «المدفوع» أكبر من صفر.
        </p>
      )}
      {salaryDoctor && (
        <p className="rounded-lg bg-primary/5 px-3 py-2 text-xs text-slate-text leading-relaxed">
          أنت على نظام <strong>راتب ثابت</strong>. يُسجّل صرف راتبك من
          «صرفيات عامة» ويظهر في السجل المالي.
        </p>
      )}
      <div
        className={`rounded-2xl p-8 text-white shadow-premium ${
          stats?.isDebtor
            ? "bg-gradient-to-br from-red-600 to-red-800"
            : "bg-gradient-to-br from-primary to-primary-700"
        }`}
      >
        <p className="text-sm opacity-90">
          {salaryDoctor
            ? "المتبقي من الراتب (قابل للصرف)"
            : stats?.isDebtor
              ? "الرصيد (مدين)"
              : "الرصيد القابل للسحب"}
        </p>
        <p className="mt-2 text-4xl font-bold tabular-nums">
          {stats !== null ? (
            <>
              {stats.isDebtor ? "−" : ""}
              {formatCurrency(Math.abs(stats.availableBalance))}
              {stats.isDebtor && (
                <span className="mr-2 text-base font-bold">(مدين)</span>
              )}
            </>
          ) : (
            "…"
          )}
        </p>
      </div>

      <div className="space-y-2 rounded-xl border border-slate-border bg-surface-card p-4">
        {rows.map(({ label, value, highlight }) => (
          <div key={label} className="flex justify-between text-sm">
            <span className="text-slate-muted">{label}</span>
            <span
              className={
                highlight && (value ?? 0) > 0
                  ? "font-semibold text-amber-600"
                  : "font-medium text-slate-text"
              }
            >
              {stats !== null ? formatCurrency(value ?? 0) : "…"}
            </span>
          </div>
        ))}
      </div>

      {!salaryDoctor && (
        <Link href="/doctor/withdraw">
          <Button className="w-full">
            <ArrowDownToLine className="h-4 w-4" />
            طلب سحب جديد
          </Button>
        </Link>
      )}

      {!salaryDoctor && (
        <p className="text-xs text-slate-muted text-center leading-relaxed">
          طلب السحب لا يخصم من رصيدك — يُخصم عند موافقة المحاسب أو الدفع.
          المحاسب يمكنه أيضاً تسجيل دفع نقدي مباشر.
        </p>
      )}
    </div>
  );
}
