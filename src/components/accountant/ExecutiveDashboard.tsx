"use client";

/**
 * Executive Dashboard — الميزة القاتلة
 * يعطي صاحب العيادة صافي الربح الحقيقي بضغطة واحدة
 * لا يملكها أي منافس بنفس الوضوح
 */

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useActiveClinicId } from "@/hooks/useActiveClinicId";
import {
  mergeExecutiveDashboardMetrics,
  resolveExecutiveSalaryDeduction,
  applyReportAlignedProfitMetrics,
  type ExecutiveSnapshotCore,
  type ReportAlignedProfitMetrics,
} from "@/lib/services/executive-snapshot";
import { authPortalHeaders } from "@/lib/auth/api-portal";
import { useClinicSync } from "@/hooks/useClinicSync";
import { useLanguage } from "@/contexts/LanguageContext";
import { Alert } from "@/components/ui/Alert";
import { cn, localDateISO, monthDateRange, todayISO, currentMonthYear } from "@/lib/utils";
import {
  TrendingUp, TrendingDown, Minus,
  DollarSign, Wallet, Receipt, Users,
  UserPlus, Star, Package, AlertCircle,
  ArrowUpRight, ListOrdered, UserCog,
} from "lucide-react";

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────
interface Snapshot {
  revenue: number;
  collected: number;
  debt: number;
  /** عدد المرضى الذين لديهم ذمم مستحقة الآن — لا يتبع الفترة المختارة */
  debtors_count: number;
  doctor_shares: number;
  clinic_shares: number;
  materials_cost: number;
  expenses: number;
  salaries_paid: number;
  /** ما يُخصم فعلياً من صافي الربح (رواتب مُولَّدة أو مدفوعة) */
  salaries_deducted_from_profit?: number;
  review_fees: number;
  withdrawals_paid: number;
  net_profit: number;
  operation_count: number;
  patient_count: number;
  new_patients: number;
  prev_revenue: number;
  prev_expenses: number;
  revenue_growth: number | null;
  period_from: string;
  period_to: string;
}

interface TopPerformers {
  top_doctors: Array<{
    full_name_ar: string;
    revenue: number;
    clinic_share?: number;
    doctor_share: number;
    op_count: number;
  }>;
  top_services: Array<{ service_name: string; count: number; revenue: number; avg_price: number; clinic_margin_pct: number }>;
  top_expenses: Array<{ category: string; total: number; count: number }>;
  inactive_doctors?: Array<{ full_name_ar: string; doctor_id?: string }>;
}

type Period = "today" | "week" | "month" | "custom";

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────
function fmt(n: number) {
  return new Intl.NumberFormat("en-US", {
    numberingSystem: "latn",
    maximumFractionDigits: 0,
  }).format(n);
}

function GrowthBadge({ pct }: { pct: number | null }) {
  if (pct === null) return null;
  const pos = pct > 0;
  const zero = pct === 0;
  return (
    <span className={cn(
      "flex items-center gap-0.5 rounded-full px-2 py-0.5 text-xs font-bold",
      zero ? "bg-slate-100 text-slate-500"
           : pos ? "bg-emerald-100 text-emerald-700"
                 : "bg-red-100 text-red-600"
    )}>
      {zero ? <Minus className="h-3 w-3" />
             : pos ? <TrendingUp className="h-3 w-3" />
                   : <TrendingDown className="h-3 w-3" />}
      {Math.abs(pct)}%
    </span>
  );
}

// ─────────────────────────────────────────────
// KPI Card
// ─────────────────────────────────────────────
function KpiCard({
  label, value, sub, icon: Icon, color, growth, highlight,
}: {
  label: string;
  value: string;
  sub?: string;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
  growth?: number | null;
  highlight?: boolean;
}) {
  return (
    <div className={cn(
      "relative overflow-hidden rounded-2xl border bg-white p-5 shadow-sm transition-shadow hover:shadow-md",
      highlight ? "border-primary/30 ring-2 ring-primary/10" : "border-slate-100"
    )}>
      {highlight && (
        <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-primary to-emerald-400" />
      )}
      <div className="flex items-start justify-between gap-2">
        <div className={cn("flex h-10 w-10 items-center justify-center rounded-xl", color)}>
          <Icon className="h-5 w-5" />
        </div>
        {growth !== undefined && <GrowthBadge pct={growth ?? null} />}
      </div>
      <div className="mt-3">
        <p className="text-2xl font-black tabular-nums text-slate-800">{value}</p>
        <p className="text-sm font-medium text-slate-600">{label}</p>
        {sub && <p className="mt-0.5 text-xs text-slate-400">{sub}</p>}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// Net Profit Breakdown card
// ─────────────────────────────────────────────
function NetProfitCard({ snap }: { snap: Snapshot }) {
  const { t } = useLanguage();
  const rows = [
    { label: t("execClinicShareOps"), amount: snap.clinic_shares, color: "text-emerald-600", sign: "+" },
    ...(snap.review_fees > 0
      ? [{
          label: t("execReviewFeesProfit"),
          amount: snap.review_fees,
          color: "text-emerald-600",
          sign: "+",
        }]
      : []),
    { label: t("execGeneralExpenses"), amount: -snap.expenses, color: "text-red-500", sign: "−" },
    { label: t("execSalariesDeduct"), amount: -(snap.salaries_deducted_from_profit ?? snap.salaries_paid ?? 0), color: "text-red-500", sign: "−" },
    { label: t("execTotalRevenueRef"), amount: snap.revenue, color: "text-slate-500", sign: "" },
    { label: t("execDoctorSharesRef"), amount: -snap.doctor_shares, color: "text-slate-400", sign: "−" },
  ];

  const profitColor = snap.net_profit >= 0 ? "text-emerald-600" : "text-red-600";
  const profitBg    = snap.net_profit >= 0 ? "bg-emerald-50 border-emerald-200" : "bg-red-50 border-red-200";

  return (
    <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
      <h3 className="mb-4 flex items-center gap-2 font-bold text-slate-700">
        <DollarSign className="h-5 w-5 text-primary" />
        {t("profitBreakdown")}
      </h3>
      <div className="space-y-2">
        {rows.map((row) => (
          <div key={row.label} className="flex items-center justify-between text-sm">
            <span className="text-slate-600">{row.label}</span>
            <span className={cn("font-semibold tabular-nums", row.color)}>
              {row.sign} {fmt(Math.abs(row.amount))}
            </span>
          </div>
        ))}
        <div className={cn("mt-3 flex items-center justify-between rounded-xl border p-3", profitBg)}>
          <span className="font-bold text-slate-700">{t("execNetClinicProfit")}</span>
          <span className={cn("text-xl font-black tabular-nums", profitColor)}>
            {snap.net_profit >= 0 ? "+" : ""}{fmt(snap.net_profit)}
          </span>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// Smart Alerts
// ─────────────────────────────────────────────
function SmartAlerts({ snap }: { snap: Snapshot }) {
  const { t, bi } = useLanguage();
  const alerts: { msg: string; type: "warn" | "info" | "danger" }[] = [];

  if (snap.debt > snap.collected * 0.3)
    alerts.push({
      msg: bi(
        `الديون (${fmt(snap.debt)}) تجاوزت 30% من المتحصل — تحقق من المتأخرات`,
        `Debts (${fmt(snap.debt)}) exceed 30% of collected — check overdue balances`
      ),
      type: "warn",
    });

  if (snap.revenue_growth !== null && snap.revenue_growth < -10)
    alerts.push({
      msg: bi(
        `الإيرادات انخفضت ${Math.abs(snap.revenue_growth)}% مقارنة بالفترة السابقة`,
        `Revenue dropped ${Math.abs(snap.revenue_growth)}% compared to the previous period`
      ),
      type: "danger",
    });

  const salariesPaid = snap.salaries_paid ?? 0;
  if (snap.expenses > snap.clinic_shares * 0.7)
    alerts.push({
      msg: bi(
        `المصروفات تجاوزت 70% من حصة العيادة — راجع بنود الصرف`,
        `Expenses exceeded 70% of clinic share — review spending items`
      ),
      type: "warn",
    });

  if (salariesPaid > 0 && salariesPaid > snap.clinic_shares * 0.5)
    alerts.push({
      msg: bi(
        `الرواتب المدفوعة (${fmt(salariesPaid)}) مرتفعة — راجع قسائم الشهر`,
        `Salaries paid (${fmt(salariesPaid)}) are high — review monthly payroll`
      ),
      type: "warn",
    });

  if (snap.new_patients === 0)
    alerts.push({
      msg: bi(
        "لا مرضى جدد في هذه الفترة — فكّر بحملة تسويقية",
        "No new patients in this period — consider a marketing campaign"
      ),
      type: "info",
    });

  if (alerts.length === 0) return null;

  const typeStyle = {
    warn:   "border-amber-200 bg-amber-50 text-amber-700",
    danger: "border-red-200 bg-red-50 text-red-700",
    info:   "border-blue-200 bg-blue-50 text-blue-700",
  };

  return (
    <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
      <h3 className="mb-3 flex items-center gap-2 font-bold text-slate-700">
        <AlertCircle className="h-5 w-5 text-amber-500" />
        {t("smartAlerts")}
      </h3>
      <div className="space-y-2">
        {alerts.map((a, i) => (
          <div key={i} className={cn("rounded-xl border p-3 text-sm", typeStyle[a.type])}>
            {a.msg}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// Top Doctors
// ─────────────────────────────────────────────
function TopDoctorsCard({ doctors }: { doctors: TopPerformers["top_doctors"] }) {
  const { t, formatMoney } = useLanguage();
  if (!doctors.length) return null;
  const max = doctors[0].revenue;
  return (
    <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
      <h3 className="mb-4 flex items-center gap-2 font-bold text-slate-700">
        <Star className="h-5 w-5 text-amber-500" />
        {t("topDoctors")}
      </h3>
      <div className="space-y-3">
        {doctors.map((d, i) => (
          <div key={d.full_name_ar}>
            <div className="mb-1 flex items-center justify-between text-sm">
              <span className="flex items-center gap-2 font-medium text-slate-700">
                {i === 0 && <span className="text-base">🥇</span>}
                {i === 1 && <span className="text-base">🥈</span>}
                {i === 2 && <span className="text-base">🥉</span>}
                {i > 2 && <span className="w-5 text-center text-xs text-slate-400">{i + 1}</span>}
                {d.full_name_ar}
              </span>
              <span className="font-bold text-slate-800 tabular-nums">{fmt(d.revenue)}</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-slate-100">
              <div
                className="h-full rounded-full bg-gradient-to-r from-primary to-emerald-400"
                style={{ width: `${(d.revenue / max) * 100}%` }}
              />
            </div>
            <p className="mt-0.5 text-xs text-slate-400">
              {d.op_count} {t("execTopDoctorOps")} ·{" "}
              {formatMoney(d.clinic_share ?? 0)} {t("clinicNetShare")}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// Top Services
// ─────────────────────────────────────────────
function TopServicesCard({ services }: { services: TopPerformers["top_services"] }) {
  const { t } = useLanguage();
  if (!services.length) return null;
  return (
    <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
      <h3 className="mb-4 flex items-center gap-2 font-bold text-slate-700">
        <Package className="h-5 w-5 text-primary" />
        {t("topServices")}
      </h3>
      <div className="space-y-2">
        {services.map((s) => (
          <div key={s.service_name} className="flex items-center gap-3 rounded-xl bg-slate-50 px-3 py-2.5">
            <div className="flex-1 min-w-0">
              <p className="truncate text-sm font-semibold text-slate-700">{s.service_name}</p>
              <p className="text-xs text-slate-400">{s.count} {t("execServiceTimes")} {fmt(s.avg_price)}</p>
            </div>
            <div className="text-left">
              <p className="text-sm font-bold text-slate-800 tabular-nums">{fmt(s.revenue)}</p>
              <p className="text-xs text-emerald-600">{t("execMarginPct")} {s.clinic_margin_pct}%</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────
export function ExecutiveDashboard() {
  const supabase = createClient();
  const { clinicId, loading: clinicLoading } = useActiveClinicId();
  const { t, formatMoney } = useLanguage();
  const [period, setPeriod] = useState<Period>("month");
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [top, setTop]   = useState<TopPerformers | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  // date range
  const getRange = useCallback(() => {
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
        return monthDateRange(currentMonthYear());
      }
    }
  }, [period]);

  const fetchData = useCallback(async (options?: { silent?: boolean }) => {
    if (!clinicId) return;
    if (!options?.silent) setLoading(true);
    setFetchError(null);
    const { from, to } = getRange();

    try {
    const [snapRes, topRes, supplementRes] = await Promise.all([
      supabase.rpc("get_clinic_financial_snapshot", {
        p_clinic_id: clinicId, p_from: from, p_to: to,
      }),
      supabase.rpc("get_top_performers", {
        p_clinic_id: clinicId,
        p_from: from,
        p_to: to,
      }),
      fetch(`/api/executive/supplement?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, {
        credentials: "include",
        headers: authPortalHeaders("accountant"),
      }),
    ]);

    const supplementJson = supplementRes.ok
      ? ((await supplementRes.json()) as {
          salariesDisplay?: number;
          salariesPaidLegacy?: number;
          payrollAccruals?: number;
          visitorDebt?: { debt: number; visitorCount: number };
          totalDebt?: { debt: number; debtorCount: number };
          reportAligned?: ReportAlignedProfitMetrics;
          error?: string;
        })
      : null;

    const {
      salariesDisplay = 0,
      salariesPaidLegacy = 0,
      payrollAccruals = 0,
      visitorDebt = { debt: 0, visitorCount: 0 },
      totalDebt = { debt: 0, debtorCount: 0 },
      reportAligned,
    } = supplementJson ?? {};

    const salariesDeducted = reportAligned
      ? reportAligned.salariesDeducted
      : resolveExecutiveSalaryDeduction(payrollAccruals, salariesPaidLegacy);

    if (snapRes.error) {
      setFetchError(
        snapRes.error.message || t("execLoadSummaryError")
      );
    }

    const baseSnap: Snapshot = snapRes.data
      ? (() => {
          const merged = mergeExecutiveDashboardMetrics(
            snapRes.data as unknown as ExecutiveSnapshotCore,
            {
              salariesPaid: salariesDisplay,
              salariesDeductedFromProfit: salariesDeducted,
              reviewFees: Number(
                (snapRes.data as Record<string, unknown>).review_fees ?? 0
              ),
            }
          ) as unknown as Snapshot;
          return reportAligned
            ? (applyReportAlignedProfitMetrics(
                merged as unknown as ExecutiveSnapshotCore,
                reportAligned
              ) as unknown as Snapshot)
            : merged;
        })()
      : {
          revenue: 0,
          collected: 0,
          debt: 0,
          debtors_count: 0,
          doctor_shares: 0,
          clinic_shares: 0,
          materials_cost: 0,
          expenses: 0,
          salaries_paid: salariesDisplay,
          review_fees: Number(
            (snapRes.data as Record<string, unknown>)?.review_fees ?? 0
          ),
          withdrawals_paid: 0,
          net_profit: 0,
          operation_count: 0,
          patient_count: visitorDebt.visitorCount,
          new_patients: 0,
          prev_revenue: 0,
          prev_expenses: 0,
          revenue_growth: null,
          period_from: from,
          period_to: to,
        };

    setSnap({
      ...baseSnap,
      salaries_deducted_from_profit: salariesDeducted,
      // الذمم إجمالي حالي — لا يتصفّر ببداية فترة/شهر جديد (منفصل عن مراجعي الفترة)
      debt: totalDebt.debt,
      debtors_count: totalDebt.debtorCount,
      patient_count:
        visitorDebt.visitorCount > 0
          ? visitorDebt.visitorCount
          : baseSnap.patient_count,
    });

    if (topRes.data) setTop(topRes.data as TopPerformers);
    } catch (err) {
      setFetchError(
        err instanceof Error ? err.message : t("execLoadProfitError")
      );
    } finally {
    setLoading(false);
    }
  }, [clinicId, getRange, supabase, t]);

  useEffect(() => {
    if (clinicLoading || clinicId === undefined) return;
    if (!clinicId) {
      setLoading(false);
      return;
    }
    fetchData();
  }, [fetchData, clinicLoading, clinicId]);

  useClinicSync({
    topics: ["profit", "sessions", "refunds", "financial"],
    clinicId,
    onRefresh: () => fetchData({ silent: true }),
    enabled: !!clinicId,
  });

  const PERIODS = [
    { key: "today" as Period, label: t("today") },
    { key: "week"  as Period, label: t("thisWeek") },
    { key: "month" as Period, label: t("thisMonth") },
  ];

  return (
    <div id="profit-dashboard" className="space-y-6">

      {/* Period selector */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-bold text-slate-800">{t("executiveDashboard")}</h2>
        <div className="flex gap-1 rounded-xl border border-slate-200 bg-white p-1 shadow-sm">
          {PERIODS.map((p) => (
            <button
              key={p.key}
              onClick={() => setPeriod(p.key)}
              className={cn(
                "rounded-lg px-4 py-1.5 text-sm font-medium transition-colors",
                period === p.key
                  ? "bg-primary text-white shadow-sm"
                  : "text-slate-600 hover:bg-slate-50"
              )}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {fetchError && (
        <Alert variant="error">
          {fetchError}
          <p className="mt-2 text-sm">{t("execDoctorPctHint")}</p>
        </Alert>
      )}

      {loading || !snap ? (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {Array.from({ length: 10 }).map((_, i) => (
            <div key={i} className="h-28 animate-pulse rounded-2xl bg-slate-100" />
          ))}
        </div>
      ) : (
        <>
          {/* KPI grid */}
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <KpiCard
              label={t("netProfit")}
              value={formatMoney(snap.net_profit)}
              icon={TrendingUp}
              color={snap.net_profit >= 0 ? "bg-emerald-100 text-emerald-600" : "bg-red-100 text-red-600"}
              growth={snap.revenue_growth}
              highlight
            />
            <KpiCard
              label={t("totalRevenue")}
              value={formatMoney(snap.revenue)}
              sub={`${t("execCollectedSub")}: ${fmt(snap.collected)}`}
              icon={DollarSign}
              color="bg-blue-100 text-blue-600"
              growth={snap.revenue_growth}
            />
            <KpiCard
              label={t("execPatientDebts")}
              value={formatMoney(snap.debt)}
              sub={
                snap.debt > 0
                  ? `${t("execDebtSub")} ${snap.debtors_count} ${t("execPatientsInPeriod")}`
                  : t("execNoDebtSub")
              }
              icon={Receipt}
              color="bg-amber-100 text-amber-600"
            />
            <KpiCard
              label={t("totalExpenses")}
              value={formatMoney(snap.expenses)}
              sub={
                (snap.salaries_paid ?? 0) > 0
                  ? `${t("execSalariesInExpenses")}: ${fmt(snap.salaries_paid ?? 0)}`
                  : undefined
              }
              icon={Wallet}
              color="bg-red-100 text-red-500"
            />
            <KpiCard
              label={t("execSalariesPaid")}
              value={formatMoney(snap.salaries_paid ?? 0)}
              sub={t("execSalariesPaidSub")}
              icon={UserCog}
              color="bg-rose-100 text-rose-600"
            />
            <KpiCard
              label={t("execReviewVisits")}
              value={formatMoney(snap.review_fees ?? 0)}
              sub={t("execReviewVisitsSub")}
              icon={Receipt}
              color="bg-teal-100 text-teal-700"
            />
            <KpiCard
              label={t("treatedPatients")}
              value={String(snap.patient_count)}
              sub={`${snap.operation_count} ${t("execOperationsCount")}`}
              icon={Users}
              color="bg-violet-100 text-violet-600"
            />
            <KpiCard
              label={t("newPatients")}
              value={String(snap.new_patients)}
              icon={UserPlus}
              color="bg-pink-100 text-pink-600"
            />
            <KpiCard
              label={t("clinicNetShare")}
              value={formatMoney(snap.clinic_shares)}
              sub={t("execBeforeExpenses")}
              icon={ArrowUpRight}
              color="bg-emerald-100 text-emerald-600"
            />
            <KpiCard
              label={t("execDoctorWalletsRef")}
              value={formatMoney(snap.doctor_shares)}
              sub={`${t("execWithdrawnSub")}: ${fmt(snap.withdrawals_paid)}`}
              icon={ListOrdered}
              color="bg-orange-100 text-orange-500"
            />
          </div>

          {/* Row 2: breakdown + alerts */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <NetProfitCard snap={snap} />
            <SmartAlerts snap={snap} />
          </div>

          {/* Row 3: top performers */}
          {top && (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <TopDoctorsCard doctors={top.top_doctors} />
              <TopServicesCard services={top.top_services} />
            </div>
          )}
        </>
      )}
    </div>
  );
}
