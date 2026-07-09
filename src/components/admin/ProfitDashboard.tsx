"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardHeader, CardTitle } from "@/components/ui/Card";
import { useClinicSync } from "@/hooks/useClinicSync";
import {
  defaultClinicProfitPeriod,
  fetchAlignedClinicProfitStats,
} from "@/lib/services/clinic-profit-loader";
import { useActiveClinicId } from "@/hooks/useActiveClinicId";
import type { ClinicProfitStats } from "@/lib/services/clinic-stats";
import { formatCurrency } from "@/lib/utils";
import { authPortalHeaders } from "@/lib/auth/api-portal";
import { TrendingDown, TrendingUp, Wallet, AlertCircle } from "lucide-react";
import { ProfitExplanationButton } from "@/components/finance/ProfitExplanationModal";
import { subscribePendingClinicTopUpChanges } from "@/lib/services/clinic-profit-pending";
import { subscribeClinicProfitBroadcast } from "@/lib/services/clinic-profit-broadcast";

interface ProfitDashboardProps {
  mobile?: boolean;
}

/** إجمالي الذمم الحالية على كل مرضى العيادة — عبر نفس مصدر اللوحة التنفيذية */
async function fetchTotalOutstandingDebt(
  from: string,
  to: string,
  clinicId: string
): Promise<number | null> {
  try {
    const params = new URLSearchParams({ from, to, clinic_id: clinicId });
    const res = await fetch(`/api/executive/supplement?${params.toString()}`, {
      credentials: "include",
      headers: authPortalHeaders("admin"),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      totalDebt?: { debt: number; debtorCount: number };
    };
    return json.totalDebt?.debt ?? null;
  } catch {
    return null;
  }
}

export function ProfitDashboard({ mobile }: ProfitDashboardProps) {
  const { clinicId, loading: clinicLoading } = useActiveClinicId();
  const [stats, setStats] = useState<ClinicProfitStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!clinicId) {
      setLoading(false);
      return;
    }
    try {
      const period = defaultClinicProfitPeriod();
      const [data, totalDebt] = await Promise.all([
        fetchAlignedClinicProfitStats(clinicId, "accountant", period),
        fetchTotalOutstandingDebt(period.from, period.to, clinicId),
      ]);
      setStats(
        totalDebt !== null ? { ...data, outstandingDebts: totalDebt } : data
      );
      setError(null);
    } catch {
      setError("تعذر تحميل بيانات الأرباح");
    }
    setLoading(false);
  }, [clinicId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    return subscribePendingClinicTopUpChanges(() => {
      void load();
    });
  }, [load]);

  useEffect(() => {
    return subscribeClinicProfitBroadcast(() => {
      void load();
    });
  }, [load]);

  useClinicSync({
    topics: ["profit", "financial"],
    clinicId,
    onRefresh: () => void load(),
    enabled: !!clinicId,
  });

  if (clinicLoading || loading) {
    return (
      <p className="text-center text-slate-muted py-12">جاري تحميل لوحة الأرباح...</p>
    );
  }

  if (error || !stats) {
    return (
      <p className="text-center text-debt-text py-12">
        {error ?? "لا توجد بيانات"}
      </p>
    );
  }

  const { from, to } = defaultClinicProfitPeriod();

  const cards = [
    {
      label: "إجمالي التدفق النقدي",
      value: stats.cashInflow,
      icon: Wallet,
      color: "text-primary",
      bg: "bg-primary/10",
    },
    {
      label: "إجمالي الديون المعلّقة",
      value: stats.outstandingDebts,
      icon: AlertCircle,
      color: "text-debt-text",
      bg: "bg-debt/50",
    },
    {
      label: "صافي ربح العيادة",
      value: stats.netProfit,
      icon: stats.netProfit >= 0 ? TrendingUp : TrendingDown,
      color: stats.netProfit >= 0 ? "text-primary" : "text-debt-text",
      bg: "bg-surface",
      highlight: true,
    },
  ];

  return (
    <div className="space-y-4 sm:space-y-6">
      <div
        className={
          mobile
            ? "grid grid-cols-1 gap-3"
            : "grid gap-4 sm:grid-cols-3"
        }
      >
        {cards.map((c) => (
          <Card
            key={c.label}
            hoverable
            premium={c.highlight}
          >
            <CardHeader>
              <div className={`mb-2 inline-flex rounded-lg p-2 ${c.bg}`}>
                <c.icon className={`h-5 w-5 ${c.color}`} />
              </div>
              <p className="text-sm text-slate-muted">{c.label}</p>
              <p
                className={`font-bold tabular-nums ${c.color} ${mobile ? "text-2xl" : "text-3xl"}`}
              >
                {formatCurrency(c.value)}
              </p>
            </CardHeader>
          </Card>
        ))}
      </div>

      <Card premium>
        <CardHeader>
          <div className="flex items-start justify-between gap-2">
            <div>
          <CardTitle>تفصيل الحساب</CardTitle>
              <p className="mt-1 text-xs text-slate-muted">
                اضغط «توضيح الربح» أو افتح{" "}
                <a href="/admin/financial-history" className="text-primary underline">
                  سجل الصرفيات
                </a>{" "}
                لكل العمليات السابقة
              </p>
            </div>
            <ProfitExplanationButton
              from={from}
              to={to}
              portal="admin"
              netProfit={stats.netProfit}
              size="sm"
              variant="premium"
            />
          </div>
        </CardHeader>
        <div className="space-y-2">
          {stats.breakdown.map((row) => (
            <div
              key={row.label}
              className="flex justify-between border-b border-slate-border/60 py-2 text-sm last:border-0"
            >
              <span className="text-slate-muted">{row.label}</span>
              <span
                className={
                  row.amount < 0
                    ? "font-medium text-debt-text"
                    : row.label === "صافي ربح العيادة"
                      ? "font-bold text-primary"
                      : "font-medium text-slate-text"
                }
              >
                {formatCurrency(Math.abs(row.amount))}
                {row.amount < 0 && row.label !== "صافي ربح العيادة" ? " −" : ""}
              </span>
            </div>
          ))}
        </div>
      </Card>

      <div
        className={
          mobile ? "grid grid-cols-1 gap-3" : "grid gap-4 sm:grid-cols-2"
        }
      >
        <Card hoverable>
          <CardHeader>
            <p className="text-sm text-slate-muted">حصة العيادة (الشهر)</p>
            <p className="text-xl font-bold tabular-nums text-slate-text">
              {formatCurrency(stats.clinicShareTotal)}
            </p>
          </CardHeader>
        </Card>
        <Card hoverable>
          <CardHeader>
            <p className="text-sm text-slate-muted">مصروفات + رواتب مدفوعة</p>
            <p className="text-xl font-bold tabular-nums text-debt-text">
              {formatCurrency(stats.totalExpenses + stats.totalSalariesPaid)}
            </p>
          </CardHeader>
        </Card>
      </div>

      {!mobile && (
        <Card>
          <CardHeader>
            <CardTitle>صيغة الحساب</CardTitle>
          </CardHeader>
          <p className="text-sm text-slate-muted leading-relaxed">
            صافي الربح = حصة العيادة (علاج + كشفيات) − مصروفات العيادة −
            رواتب مؤكَّد صرفها (نفس الكشف المالي). التدفق النقدي = مجموع
            المبالغ المحصّلة في الشهر (يشمل حصة الأطباء).
          </p>
        </Card>
      )}
    </div>
  );
}
