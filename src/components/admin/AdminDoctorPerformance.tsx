"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useActiveClinicId } from "@/hooks/useActiveClinicId";
import { useClinicSync } from "@/hooks/useClinicSync";
import { Card } from "@/components/ui/Card";
import { Alert } from "@/components/ui/Alert";
import { cn, formatCurrency, localDateISO, todayISO } from "@/lib/utils";
import {
  buildDoctorPerformanceHighlights,
  type DoctorPerformanceHighlights,
  type DoctorPerformanceRow,
  type TopPerformersPayload,
} from "@/lib/services/doctor-performance";
import {
  Award,
  ChevronLeft,
  Crown,
  Moon,
  Star,
  Stethoscope,
  TrendingUp,
  Zap,
} from "lucide-react";

type Period = "today" | "week" | "month";

const PERIODS: { key: Period; label: string }[] = [
  { key: "today", label: "اليوم" },
  { key: "week", label: "الأسبوع" },
  { key: "month", label: "الشهر" },
];

function getRange(period: Period): { from: string; to: string } {
  const todayStr = todayISO();
  const today = new Date();

  switch (period) {
    case "today":
      return { from: todayStr, to: todayStr };
    case "week": {
      const w = new Date(today);
      w.setDate(today.getDate() - 6);
      return { from: localDateISO(w), to: todayStr };
    }
    case "month":
    default: {
      const m = new Date(today.getFullYear(), today.getMonth(), 1);
      return { from: localDateISO(m), to: todayStr };
    }
  }
}

function HighlightCard({
  title,
  subtitle,
  doctor,
  metric,
  metricLabel,
  icon: Icon,
}: {
  title: string;
  subtitle: string;
  doctor: DoctorPerformanceRow | null;
  metric: string;
  metricLabel: string;
  icon: typeof Crown;
}) {
  return (
    <div className="rounded-xl border border-slate-border bg-surface-card p-4 shadow-card">
      <div className="mb-3 flex items-start justify-between gap-2">
        <div>
          <p className="text-xs font-semibold text-slate-muted">{title}</p>
          <p className="text-[11px] text-slate-muted">{subtitle}</p>
        </div>
        <div className="rounded-xl bg-primary/10 p-2 text-primary">
          <Icon className="h-5 w-5" />
        </div>
      </div>
      {doctor ? (
        <>
          <p className="truncate text-base font-bold text-slate-text">
            {doctor.full_name_ar}
          </p>
          <p className="mt-1 text-lg font-bold tabular-nums text-primary">
            {metric}
          </p>
          <p className="text-xs text-slate-muted">{metricLabel}</p>
          <p className="mt-2 text-[11px] text-slate-muted">
            {doctor.op_count} عملية · إيراد {formatCurrency(doctor.revenue)}
          </p>
        </>
      ) : (
        <p className="py-4 text-sm text-slate-muted">لا توجد بيانات في هذه الفترة</p>
      )}
    </div>
  );
}

function RankingRow({
  doctor,
  index,
  maxRevenue,
}: {
  doctor: DoctorPerformanceRow;
  index: number;
  maxRevenue: number;
}) {
  const width =
    maxRevenue > 0 ? Math.max(8, (doctor.revenue / maxRevenue) * 100) : 0;
  const medals = ["🥇", "🥈", "🥉"];

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2 text-sm">
        <span className="flex min-w-0 items-center gap-2 font-medium text-slate-800">
          {index < 3 ? (
            <span className="text-base">{medals[index]}</span>
          ) : (
            <span className="w-5 text-center text-xs text-slate-400">
              {index + 1}
            </span>
          )}
          <span className="truncate">{doctor.full_name_ar}</span>
        </span>
        <span className="shrink-0 font-bold tabular-nums text-slate-900">
          {formatCurrency(doctor.revenue)}
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-slate-100">
        <div
          className="h-full rounded-full bg-gradient-to-r from-primary to-primary-700"
          style={{ width: `${width}%` }}
        />
      </div>
      <p className="text-[11px] text-slate-muted">
        {doctor.op_count} عملية · حصة العيادة {formatCurrency(doctor.clinic_share)}{" "}
        · حصة الطبيب {formatCurrency(doctor.doctor_share)}
      </p>
    </div>
  );
}

export function AdminDoctorPerformance() {
  const { clinicId, clinicName, loading: clinicLoading } = useActiveClinicId();
  const [period, setPeriod] = useState<Period>("month");
  const [resolvedClinicName, setResolvedClinicName] = useState("");
  const [highlights, setHighlights] =
    useState<DoctorPerformanceHighlights | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(
    async (options?: { silent?: boolean }) => {
      if (!clinicId) return;
      if (!options?.silent) setLoading(true);
      setError(null);

      const { from, to } = getRange(period);
      const res = await fetch(
        `/api/admin/doctor-performance?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
        { credentials: "include" }
      );
      const json = (await res.json()) as {
        error?: string;
        clinicName?: string;
        payload?: TopPerformersPayload;
      };

      if (!res.ok) {
        setError(json.error ?? "تعذر تحميل أداء الأطباء");
        setHighlights(null);
      } else if (json.payload) {
        setResolvedClinicName(json.clinicName ?? clinicName);
        setHighlights(buildDoctorPerformanceHighlights(json.payload));
      }
      setLoading(false);
    },
    [clinicId, period, clinicName]
  );

  useEffect(() => {
    if (clinicLoading || clinicId === undefined) return;
    if (!clinicId) {
      setLoading(false);
      return;
    }
    void fetchData();
  }, [fetchData, clinicLoading, clinicId]);

  useClinicSync({
    topics: ["sessions", "financial"],
    clinicId: clinicId ?? undefined,
    onRefresh: () => fetchData({ silent: true }),
    enabled: !!clinicId,
  });

  const maxRevenue = useMemo(
    () =>
      highlights?.ranking.reduce(
        (m, d) => Math.max(m, d.revenue),
        0
      ) ?? 0,
    [highlights]
  );

  if (clinicLoading || loading) {
    return (
      <Card className="p-4">
        <div className="mb-3 h-6 w-40 animate-pulse rounded bg-slate-100" />
        <div className="grid gap-3 sm:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-28 animate-pulse rounded-2xl bg-slate-100" />
          ))}
        </div>
      </Card>
    );
  }

  if (!clinicId) return null;

  return (
    <Card className="overflow-hidden p-0">
      <div className="border-b border-slate-border bg-surface-card px-4 py-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <div className="rounded-xl bg-primary/10 p-2 text-primary">
              <Stethoscope className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-text">
                أداء الأطباء
              </h3>
              <p className="text-xs text-slate-muted">
                {resolvedClinicName || clinicName
                  ? `عيادة: ${resolvedClinicName || clinicName} · `
                  : ""}
                إيراد · حصة العيادة · النشاط · الخمول
              </p>
            </div>
          </div>
          <div className="flex gap-1 rounded-xl border border-slate-border bg-surface p-1">
            {PERIODS.map((p) => (
              <button
                key={p.key}
                type="button"
                onClick={() => setPeriod(p.key)}
                className={cn(
                  "rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors",
                  period === p.key
                    ? "bg-primary text-white shadow-sm"
                    : "text-slate-muted hover:bg-surface-card"
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="space-y-4 p-4">
        {error && (
          <Alert variant="error">
            تعذر تحميل أداء الأطباء: {error}
            <p className="mt-1 text-xs">
              إن ظهر خطأ عمود — شغّل script 35 في Supabase ثم أعد المحاولة.
            </p>
          </Alert>
        )}

        {highlights && (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <HighlightCard
                title="أعلى إيراد"
                subtitle="إجمالي فواتير الجلسات"
                doctor={highlights.topByRevenue}
                metric={
                  highlights.topByRevenue
                    ? formatCurrency(highlights.topByRevenue.revenue)
                    : "—"
                }
                metricLabel="إيراد الفترة"
                icon={Crown}
              />
              <HighlightCard
                title="أفضل لربح العيادة"
                subtitle="أعلى حصة عيادة من العمليات"
                doctor={highlights.topByClinicShare}
                metric={
                  highlights.topByClinicShare
                    ? formatCurrency(highlights.topByClinicShare.clinic_share)
                    : "—"
                }
                metricLabel="حصة العيادة"
                icon={TrendingUp}
              />
              <HighlightCard
                title="الأكثر نشاطاً"
                subtitle="أكثر عدد عمليات"
                doctor={highlights.mostActive}
                metric={
                  highlights.mostActive
                    ? String(highlights.mostActive.op_count)
                    : "—"
                }
                metricLabel="عملية في الفترة"
                icon={Zap}
              />
              <HighlightCard
                title="الأقل نشاطاً"
                subtitle="أقل عمليات (ضمن النشطين)"
                doctor={highlights.leastActive}
                metric={
                  highlights.leastActive
                    ? String(highlights.leastActive.op_count)
                    : highlights.inactive.length > 0
                      ? "0"
                      : "—"
                }
                metricLabel={
                  highlights.leastActive
                    ? "عملية في الفترة"
                    : "لا يوجد طبيب نشط للمقارنة"
                }
                icon={Award}
              />
            </div>

            {highlights.inactive.length > 0 && (
              <div className="rounded-xl border border-slate-border bg-primary/5 p-4">
                <div className="mb-2 flex items-center gap-2">
                  <Moon className="h-4 w-4 text-primary" />
                  <p className="text-sm font-bold text-slate-text">
                    أطباء بدون عمليات في الفترة ({highlights.inactive.length})
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {highlights.inactive.map((d) => (
                    <span
                      key={d.doctor_id ?? d.full_name_ar}
                      className="rounded-full border border-slate-border bg-surface-card px-3 py-1 text-xs font-medium text-slate-text"
                    >
                      {d.full_name_ar}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {highlights.ranking.length > 0 ? (
              <div>
                <div className="mb-3 flex items-center justify-between">
                  <p className="flex items-center gap-1.5 text-sm font-bold text-slate-text">
                    <Star className="h-4 w-4 text-primary" />
                    ترتيب الأطباء
                  </p>
                  <Link
                    href="/admin/doctors"
                    className="text-xs font-semibold text-primary"
                  >
                    كل الحسابات ←
                  </Link>
                </div>
                <div className="space-y-4">
                  {highlights.ranking.map((doctor, index) => (
                    <RankingRow
                      key={doctor.doctor_id ?? doctor.full_name_ar}
                      doctor={doctor}
                      index={index}
                      maxRevenue={maxRevenue}
                    />
                  ))}
                </div>
              </div>
            ) : (
              !highlights.inactive.length && (
                <p className="py-6 text-center text-sm text-slate-muted">
                  لا توجد عمليات مسجّلة في هذه الفترة
                </p>
              )
            )}
          </>
        )}

        <Link
          href="/admin/doctors"
          className="flex items-center justify-between rounded-xl border border-slate-border bg-surface-card px-4 py-3 text-sm font-medium text-slate-text transition-colors hover:bg-surface"
        >
          <span>عرض دفاتر الأطباء المالية التفصيلية</span>
          <ChevronLeft className="h-4 w-4 text-slate-muted" />
        </Link>
      </div>
    </Card>
  );
}
