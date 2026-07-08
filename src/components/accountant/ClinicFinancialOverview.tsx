"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardHeader, CardTitle } from "@/components/ui/Card";
import { createClient } from "@/lib/supabase/client";
import { useActiveClinicId } from "@/hooks/useActiveClinicId";
import { useClinicSync } from "@/hooks/useClinicSync";
import { fetchAlignedClinicProfitStats } from "@/lib/services/clinic-profit-loader";
import { fetchTodaySummary, type ClinicProfitStats } from "@/lib/services/clinic-stats";
import { formatCurrency, todayISO } from "@/lib/utils";
import { TrendingUp, Wallet, Receipt, AlertCircle } from "lucide-react";

export function ClinicFinancialOverview() {
  const { clinicId } = useActiveClinicId();
  const [today, setToday] = useState({
    operationsCount: 0,
    totalRemainingDebt: 0,
    totalCollected: 0,
  });
  const [profit, setProfit] = useState<ClinicProfitStats | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!clinicId) {
      setLoading(false);
      return;
    }

    const supabase = createClient();
    const period = { from: "2000-01-01", to: todayISO() };
    const [t, p] = await Promise.all([
      fetchTodaySummary(supabase),
      fetchAlignedClinicProfitStats(clinicId, "accountant", period).catch(
        () => null
      ),
    ]);
    setToday(t);
    setProfit(p);
    setLoading(false);
  }, [clinicId]);

  useEffect(() => {
    void load();
  }, [load]);

  useClinicSync({
    topics: ["profit", "financial", "sessions"],
    clinicId,
    onRefresh: () => void load(),
    enabled: !!clinicId,
  });

  const kpis = [
    {
      label: "صافي ربح العيادة",
      value: profit?.netProfit ?? 0,
      icon: TrendingUp,
      color: "text-primary bg-primary/10",
    },
    {
      label: "مقبوضات اليوم",
      value: today.totalCollected,
      icon: Wallet,
      color: "text-emerald-700 bg-emerald-50",
    },
    {
      label: "ديون متبقية",
      value: today.totalRemainingDebt,
      icon: AlertCircle,
      color: "text-debt-text bg-debt/30",
    },
    {
      label: "مصروفات + رواتب",
      value: (profit?.totalExpenses ?? 0) + (profit?.totalSalariesPaid ?? 0),
      icon: Receipt,
      color: "text-purple-700 bg-purple-50",
    },
  ];

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {kpis.map(({ label, value, icon: Icon, color }) => (
          <Card key={label} className="transition-shadow hover:shadow-premium">
            <div className="flex items-start gap-3">
              <div className={`rounded-lg p-2 ${color}`}>
                <Icon className="h-5 w-5" />
              </div>
              <div>
                <p className="text-xs text-slate-muted">{label}</p>
                <p className="text-xl font-bold text-slate-text">
                  {loading ? "…" : formatCurrency(value)}
                </p>
              </div>
            </div>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>التوزيع المالي — مباشر</CardTitle>
          <p className="text-sm text-slate-muted">
            {loading
              ? "جاري التحميل..."
              : `${today.operationsCount} عملية اليوم · أرباح الأطباء منفصلة عن ربح العيادة`}
          </p>
        </CardHeader>
        {profit && (
          <div className="space-y-2">
            {profit.breakdown.map((row) => (
              <div
                key={row.label}
                className="flex justify-between border-b border-slate-border/60 py-2 text-sm last:border-0"
              >
                <span className="text-slate-muted">{row.label}</span>
                <span
                  className={
                    row.amount < 0
                      ? "font-medium text-amber-700"
                      : row.label.includes("صافي")
                        ? "font-bold text-primary"
                        : "font-medium text-slate-text"
                  }
                >
                  {formatCurrency(Math.abs(row.amount))}
                  {row.amount < 0 ? " −" : ""}
                </span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
