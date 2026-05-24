"use client";

import { useEffect, useState } from "react";
import { Card, CardHeader, CardTitle } from "@/components/ui/Card";
import { createClient } from "@/lib/supabase/client";
import {
  fetchClinicProfitStats,
  type ClinicProfitStats,
} from "@/lib/services/clinic-stats";
import { formatCurrency } from "@/lib/utils";
import { TrendingDown, TrendingUp, Wallet, AlertCircle } from "lucide-react";

interface ProfitDashboardProps {
  mobile?: boolean;
}

export function ProfitDashboard({ mobile }: ProfitDashboardProps) {
  const [stats, setStats] = useState<ClinicProfitStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      try {
        const data = await fetchClinicProfitStats(supabase);
        setStats(data);
      } catch {
        setError("تعذر تحميل بيانات الأرباح");
      }
      setLoading(false);
    }
    load();
  }, []);

  if (loading) {
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
            className={c.highlight ? "ring-2 ring-primary shadow-premium" : ""}
          >
            <CardHeader>
              <div className={`mb-2 inline-flex rounded-lg p-2 ${c.bg}`}>
                <c.icon className={`h-5 w-5 ${c.color}`} />
              </div>
              <p className="text-sm text-slate-muted">{c.label}</p>
              <p
                className={`font-bold ${c.color} ${mobile ? "text-2xl" : "text-3xl"}`}
              >
                {formatCurrency(c.value)}
              </p>
            </CardHeader>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>تفصيل الحساب</CardTitle>
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
                    : row.label === "صافي الربح"
                      ? "font-bold text-primary"
                      : "font-medium text-slate-text"
                }
              >
                {formatCurrency(Math.abs(row.amount))}
                {row.amount < 0 && row.label !== "صافي الربح" ? " −" : ""}
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
        <Card>
          <CardHeader>
            <p className="text-sm text-slate-muted">حصة العيادة (تراكمي)</p>
            <p className="text-xl font-bold text-slate-text">
              {formatCurrency(stats.clinicShareTotal)}
            </p>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <p className="text-sm text-slate-muted">مصروفات + رواتب مدفوعة</p>
            <p className="text-xl font-bold text-debt-text">
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
            صافي الربح = حصة العيادة من العمليات − رواتب الموظفين المدفوعة −
            المصروفات العامة. التدفق النقدي = مجموع المبالغ المحصّلة من
            المرضى. الديون المعلّقة تُعرض للمتابعة ولا تُدرج في الربح حتى
            التحصيل.
          </p>
        </Card>
      )}
    </div>
  );
}
