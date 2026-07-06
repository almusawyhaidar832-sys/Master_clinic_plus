"use client";

import { Star, Package } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";
import { doctorPerformanceScore } from "@/lib/services/doctor-performance";
import type { TopPerformersPayload } from "@/lib/services/doctor-performance";

export type TopDoctorRow = Pick<
  TopPerformersPayload["top_doctors"][number],
  "full_name_ar" | "collected" | "payment_count" | "revenue"
> & {
  doctor_id?: string;
  clinic_share?: number;
  doctor_share?: number;
  op_count?: number;
};
export type TopServiceRow = TopPerformersPayload["top_services"][number];

function fmt(n: number) {
  return new Intl.NumberFormat("en-US", {
    numberingSystem: "latn",
    maximumFractionDigits: 0,
  }).format(n);
}

/** أفضل الأطباء — تقييم من 100 حسب مدفوعات المراجعين */
export function TopDoctorsCard({
  doctors,
  periodLabel,
}: {
  doctors: TopDoctorRow[];
  periodLabel: string;
}) {
  const { t } = useLanguage();
  if (!doctors.length) return null;

  const ranked = [...doctors].sort(
    (a, b) =>
      (b.collected ?? b.revenue ?? 0) - (a.collected ?? a.revenue ?? 0) ||
      (b.payment_count ?? 0) - (a.payment_count ?? 0)
  );
  const maxCollected = Math.max(
    ...ranked.map((d) => d.collected ?? d.revenue ?? 0),
    0
  );

  return (
    <div className="rounded-2xl border border-slate-border bg-surface-card p-5 shadow-card">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 font-bold text-slate-text">
          <Star className="h-5 w-5 text-premium-500" />
          {t("topDoctors")}
        </h3>
        <span className="rounded-lg bg-surface px-2.5 py-1 text-xs font-medium text-slate-muted">
          {periodLabel}
        </span>
      </div>
      <div className="space-y-3">
        {ranked.map((d, i) => {
          const collected = d.collected ?? d.revenue ?? 0;
          const score = doctorPerformanceScore(collected, maxCollected);
          const payments = d.payment_count ?? 0;
          return (
            <div key={d.doctor_id ?? d.full_name_ar}>
              <div className="mb-1 flex items-center justify-between text-sm">
                <span className="flex items-center gap-2 font-medium text-slate-text">
                  {i === 0 && <span className="text-base">🥇</span>}
                  {i === 1 && <span className="text-base">🥈</span>}
                  {i === 2 && <span className="text-base">🥉</span>}
                  {i > 2 && (
                    <span className="w-5 text-center text-xs text-slate-muted">
                      {i + 1}
                    </span>
                  )}
                  {d.full_name_ar}
                </span>
                <span className="font-bold tabular-nums text-premium-600">
                  {score}
                  <span className="text-xs font-medium text-slate-muted">
                    /100
                  </span>
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-surface">
                <div
                  className="h-full rounded-full bg-mc-gold transition-all duration-300"
                  style={{ width: `${score}%` }}
                />
              </div>
              <p className="mt-0.5 text-xs text-slate-muted">
                {payments > 0
                  ? `${payments} ${t("execTopDoctorPayments")}`
                  : t("execTopDoctorNoPayments")}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function TopServicesCard({ services }: { services: TopServiceRow[] }) {
  const { t } = useLanguage();
  if (!services.length) return null;

  return (
    <div className="rounded-2xl border border-slate-border bg-surface-card p-5 shadow-card">
      <h3 className="mb-4 flex items-center gap-2 font-bold text-slate-text">
        <Package className="h-5 w-5 text-primary" />
        {t("topServices")}
      </h3>
      <div className="space-y-2">
        {services.map((s) => (
          <div
            key={s.service_name}
            className="flex items-center gap-3 rounded-xl bg-surface px-3 py-2.5"
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-slate-text">
                {s.service_name}
              </p>
              <p className="text-xs text-slate-muted">
                {s.count} {t("execServiceTimes")} {fmt(s.avg_price)}
              </p>
            </div>
            <div className="text-left">
              <p className="text-sm font-bold tabular-nums text-slate-text">
                {fmt(s.revenue)}
              </p>
              <p className="text-xs text-success-text">
                {t("execMarginPct")} {s.clinic_margin_pct}%
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
