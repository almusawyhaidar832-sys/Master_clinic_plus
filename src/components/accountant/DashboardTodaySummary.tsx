"use client";

import { useEffect, useState } from "react";
import { Card, CardHeader, CardTitle } from "@/components/ui/Card";
import { createClient } from "@/lib/supabase/client";
import { fetchTodaySummary } from "@/lib/services/clinic-stats";
import { formatCurrency } from "@/lib/utils";

export function DashboardTodaySummary() {
  const [stats, setStats] = useState({
    operationsCount: 0,
    totalRemainingDebt: 0,
    totalCollected: 0,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const data = await fetchTodaySummary(supabase);
      setStats(data);
      setLoading(false);
    }
    load();
  }, []);

  return (
    <Card>
      <CardHeader>
        <CardTitle>ملخص اليوم</CardTitle>
        <p className="text-sm text-slate-muted">
          {loading ? "جاري التحميل..." : "بيانات عمليات اليوم الحالي"}
        </p>
      </CardHeader>
      <div className="grid grid-cols-3 gap-4 text-center">
        <div className="rounded-lg bg-surface p-4">
          <p className="text-2xl font-bold text-primary">
            {loading ? "…" : stats.operationsCount}
          </p>
          <p className="text-xs text-slate-muted">عمليات اليوم</p>
        </div>
        <div className="rounded-lg bg-debt/30 p-4">
          <p className="text-2xl font-bold text-debt-text">
            {loading ? "…" : formatCurrency(stats.totalRemainingDebt)}
          </p>
          <p className="text-xs text-slate-muted">ديون متبقية</p>
        </div>
        <div className="rounded-lg bg-surface p-4">
          <p className="text-2xl font-bold text-slate-text">
            {loading ? "…" : formatCurrency(stats.totalCollected)}
          </p>
          <p className="text-xs text-slate-muted">مقبوضات اليوم</p>
        </div>
      </div>
    </Card>
  );
}
