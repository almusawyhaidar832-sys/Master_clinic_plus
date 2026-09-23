"use client";

import { useState } from "react";
import { Input } from "@/components/ui/Input";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatTile } from "@/components/ui/StatTile";
import { Calendar, ClipboardList, Coins, Filter, Wallet } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { getDoctorForCurrentUser } from "@/lib/clinic-context";
import { useLanguage } from "@/contexts/LanguageContext";
import { formatDate, todayISO } from "@/lib/utils";
import type { PatientOperation } from "@/types";
import { fetchAllRows } from "@/lib/supabase/fetch-all-rows";

export default function DoctorFilterPage() {
  const { t, bi, formatMoney, dateLocale } = useLanguage();
  const [from, setFrom] = useState(todayISO());
  const [to, setTo] = useState(todayISO());
  const [operations, setOperations] = useState<PatientOperation[]>([]);
  const [stats, setStats] = useState({
    count: 0,
    totalEarned: 0,
    totalPaid: 0,
  });
  const [applied, setApplied] = useState(false);
  const [loading, setLoading] = useState(false);

  async function applyFilter() {
    setLoading(true);
    const supabase = createClient();
    const doctor = await getDoctorForCurrentUser(supabase);
    if (!doctor) {
      setLoading(false);
      return;
    }

    const { data } = await fetchAllRows<PatientOperation>(() =>
      supabase
        .from("patient_operations")
        .select("*, patient:patients!patient_id(full_name_ar)")
        .eq("doctor_id", doctor.id)
        .gte("operation_date", from)
        .lte("operation_date", to)
        .order("operation_date", { ascending: false })
        .order("id", { ascending: true })
    );

    const rows = data ?? [];
    setOperations(rows);
    setStats({
      count: rows.length,
      totalEarned: rows.reduce(
        (s, r) => s + Number(r.doctor_share_amount ?? 0),
        0
      ),
      totalPaid: rows.reduce((s, r) => s + Number(r.paid_amount ?? 0), 0),
    });
    setApplied(true);
    setLoading(false);
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title={t("docFilterByDateTitle")}
        eyebrow={bi("بوابة الطبيب", "Doctor portal")}
        icon={Calendar}
      />

      <section className="mc-panel">
        <div className="mc-panel-body space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Input
              label={t("docFromDate")}
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              dir="ltr"
              className="text-left"
            />
            <Input
              label={t("docToDate")}
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              dir="ltr"
              className="text-left"
            />
          </div>
          <button
            type="button"
            className="mc-btn-navy w-full py-3"
            onClick={applyFilter}
            disabled={loading}
          >
            <Filter className="h-4 w-4 text-premium-300" />
            {loading ? t("docApplyingFilter") : t("docApplyFilter")}
          </button>
        </div>
      </section>

      {applied && (
        <div className="space-y-5 animate-fade-in">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <StatTile
              icon={ClipboardList}
              tone="navy"
              value={<span className="tabular-nums">{stats.count}</span>}
              label={t("operations")}
            />
            <StatTile
              icon={Wallet}
              tone="muted"
              value={<span className="tabular-nums">{formatMoney(stats.totalPaid)}</span>}
              label={t("execCollectedSub")}
            />
            <StatTile
              icon={Coins}
              tone="gold"
              value={<span className="tabular-nums">{formatMoney(stats.totalEarned)}</span>}
              label={t("docYourShare")}
            />
          </div>

          <section className="mc-panel">
            <div className="mc-panel-head">
              <h3 className="mc-panel-title">
                <ClipboardList />
                {t("operations")}
              </h3>
            </div>
            {operations.length === 0 ? (
              <div className="mc-panel-body">
                <p className="py-6 text-center text-sm text-slate-muted">
                  {t("docNoOperationsInPeriod")}
                </p>
              </div>
            ) : (
              <ul className="divide-y divide-slate-border text-sm">
                {operations.map((op) => (
                  <li
                    key={op.id}
                    className="flex items-center justify-between gap-3 px-5 py-3.5 transition-colors hover:bg-surface"
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-semibold text-slate-text">
                        {(op.patient as { full_name_ar: string })?.full_name_ar} —{" "}
                        {op.operation_type || op.operation_name_ar || "—"}
                      </span>
                      <span className="mt-0.5 block text-xs text-slate-muted tabular-nums">
                        {formatDate(op.operation_date ?? "", dateLocale)}
                      </span>
                    </span>
                    <span className="shrink-0 rounded-full border border-premium-300/60 bg-premium-50 px-2.5 py-1 text-xs font-bold text-premium-800 tabular-nums dark:bg-premium-500/10 dark:text-premium-200">
                      {formatMoney(op.doctor_share_amount ?? 0)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
