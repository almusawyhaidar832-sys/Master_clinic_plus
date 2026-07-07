"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useActiveClinicId } from "@/hooks/useActiveClinicId";
import { useClinicSync } from "@/hooks/useClinicSync";
import { Card } from "@/components/ui/Card";
import { Alert } from "@/components/ui/Alert";
import { cn, localDateISO, todayISO } from "@/lib/utils";
import {
  normalizeTopPerformersPayload,
  type TopPerformersPayload,
} from "@/lib/services/doctor-performance";
import {
  TopDoctorsCard,
  TopServicesCard,
} from "@/components/reports/TopPerformersCards";
import { ChevronLeft, Moon, Stethoscope } from "lucide-react";

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

export function AdminDoctorPerformance() {
  const { clinicId, clinicName, loading: clinicLoading } = useActiveClinicId();
  const [period, setPeriod] = useState<Period>("month");
  const [resolvedClinicName, setResolvedClinicName] = useState("");
  const [payload, setPayload] = useState<TopPerformersPayload | null>(null);
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
        setPayload(null);
      } else if (json.payload) {
        setResolvedClinicName(json.clinicName ?? clinicName);
        setPayload(normalizeTopPerformersPayload(json.payload));
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
    topics: ["sessions", "financial", "profit"],
    clinicId: clinicId ?? undefined,
    onRefresh: () => fetchData({ silent: true }),
    enabled: !!clinicId,
  });

  const periodLabel = PERIODS.find((p) => p.key === period)?.label ?? "";

  if (clinicLoading || loading) {
    return (
      <Card className="p-4">
        <div className="mb-3 h-6 w-40 animate-pulse rounded bg-slate-100" />
        <div className="grid gap-3 lg:grid-cols-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="h-48 animate-pulse rounded-2xl bg-slate-100" />
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
                أفضل الأطباء والخدمات
              </h3>
              <p className="text-xs text-slate-muted">
                {resolvedClinicName || clinicName
                  ? `عيادة: ${resolvedClinicName || clinicName} · `
                  : ""}
                تقييم من 100 حسب مدفوعات المراجعين
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

        {payload && (
          <>
            {(payload.top_doctors.length > 0 || payload.top_services.length > 0) && (
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <TopDoctorsCard
                  doctors={payload.top_doctors}
                  periodLabel={periodLabel}
                />
                <TopServicesCard services={payload.top_services} />
              </div>
            )}

            {payload.top_doctors.length === 0 &&
              payload.top_services.length === 0 &&
              payload.inactive_doctors.length === 0 && (
                <p className="py-6 text-center text-sm text-slate-muted">
                  لا توجد عمليات مسجّلة في هذه الفترة
                </p>
              )}

            {payload.inactive_doctors.length > 0 && (
              <div className="rounded-xl border border-slate-border bg-primary/5 p-4">
                <div className="mb-2 flex items-center gap-2">
                  <Moon className="h-4 w-4 text-primary" />
                  <p className="text-sm font-bold text-slate-text">
                    أطباء بدون دفعات في الفترة ({payload.inactive_doctors.length})
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {payload.inactive_doctors.map((d) => (
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
