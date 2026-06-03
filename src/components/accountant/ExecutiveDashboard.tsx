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
  fetchPaidSalariesForDisplay,
  fetchPaidSalariesForProfitDeduction,
  fetchReviewFeesInPeriod,
  fetchPeriodVisitorDebt,
  mergeExecutiveDashboardMetrics,
  type ExecutiveSnapshotCore,
} from "@/lib/services/executive-snapshot";
import { cn, localDateISO, todayISO } from "@/lib/utils";
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
  doctor_shares: number;
  clinic_shares: number;
  materials_cost: number;
  expenses: number;
  salaries_paid: number;
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
  top_doctors: Array<{ full_name_ar: string; revenue: number; doctor_share: number; op_count: number }>;
  top_services: Array<{ service_name: string; count: number; revenue: number; avg_price: number; clinic_margin_pct: number }>;
  top_expenses: Array<{ category: string; total: number; count: number }>;
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
  const rows = [
    { label: "إجمالي الإيرادات",        amount: snap.revenue,       color: "text-emerald-600", sign: "+" },
    { label: "حصص الأطباء (محافظ)",     amount: -snap.doctor_shares, color: "text-red-500",    sign: "−" },
    ...(snap.review_fees > 0
      ? [{
          label: "كشفيات مراجع (ربح العيادة)",
          amount: snap.review_fees,
          color: "text-emerald-600",
          sign: "+",
        }]
      : []),
    { label: "تكلفة المواد المستهلكة",  amount: -snap.materials_cost,color: "text-orange-500", sign: "−" },
    { label: "المصروفات العامة",         amount: -snap.expenses,      color: "text-red-500",    sign: "−" },
    { label: "رواتب موظفين (مُسلَّمة)",  amount: -(snap.salaries_paid ?? 0), color: "text-red-500", sign: "−" },
  ];

  const profitColor = snap.net_profit >= 0 ? "text-emerald-600" : "text-red-600";
  const profitBg    = snap.net_profit >= 0 ? "bg-emerald-50 border-emerald-200" : "bg-red-50 border-red-200";

  return (
    <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
      <h3 className="mb-4 flex items-center gap-2 font-bold text-slate-700">
        <DollarSign className="h-5 w-5 text-primary" />
        تحليل صافي الربح
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
          <span className="font-bold text-slate-700">صافي ربح العيادة</span>
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
  const alerts: { msg: string; type: "warn" | "info" | "danger" }[] = [];

  if (snap.debt > snap.collected * 0.3)
    alerts.push({ msg: `الديون (${fmt(snap.debt)}) تجاوزت 30% من المتحصل — تحقق من المتأخرات`, type: "warn" });

  if (snap.revenue_growth !== null && snap.revenue_growth < -10)
    alerts.push({ msg: `الإيرادات انخفضت ${Math.abs(snap.revenue_growth)}% مقارنة بالفترة السابقة`, type: "danger" });

  const salariesPaid = snap.salaries_paid ?? 0;
  if (snap.expenses > snap.clinic_shares * 0.7)
    alerts.push({ msg: `المصروفات تجاوزت 70% من حصة العيادة — راجع بنود الصرف`, type: "warn" });

  if (salariesPaid > 0 && salariesPaid > snap.clinic_shares * 0.5)
    alerts.push({ msg: `الرواتب المدفوعة (${fmt(salariesPaid)}) مرتفعة — راجع قسائم الشهر`, type: "warn" });

  if (snap.new_patients === 0)
    alerts.push({ msg: "لا مرضى جدد في هذه الفترة — فكّر بحملة تسويقية", type: "info" });

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
        تنبيهات ذكية
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
  if (!doctors.length) return null;
  const max = doctors[0].revenue;
  return (
    <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
      <h3 className="mb-4 flex items-center gap-2 font-bold text-slate-700">
        <Star className="h-5 w-5 text-amber-500" />
        أفضل الأطباء
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
            <p className="mt-0.5 text-xs text-slate-400">{d.op_count} عملية · حصة الطبيب {fmt(d.doctor_share)}</p>
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
  if (!services.length) return null;
  return (
    <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
      <h3 className="mb-4 flex items-center gap-2 font-bold text-slate-700">
        <Package className="h-5 w-5 text-primary" />
        أكثر الخدمات مبيعاً
      </h3>
      <div className="space-y-2">
        {services.map((s) => (
          <div key={s.service_name} className="flex items-center gap-3 rounded-xl bg-slate-50 px-3 py-2.5">
            <div className="flex-1 min-w-0">
              <p className="truncate text-sm font-semibold text-slate-700">{s.service_name}</p>
              <p className="text-xs text-slate-400">{s.count} مرة · متوسط {fmt(s.avg_price)}</p>
            </div>
            <div className="text-left">
              <p className="text-sm font-bold text-slate-800 tabular-nums">{fmt(s.revenue)}</p>
              <p className="text-xs text-emerald-600">هامش {s.clinic_margin_pct}%</p>
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
  const [period, setPeriod] = useState<Period>("month");
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [top, setTop]   = useState<TopPerformers | null>(null);
  const [loading, setLoading] = useState(true);

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
        const m = new Date(today.getFullYear(), today.getMonth(), 1);
        return { from: localDateISO(m), to: todayStr };
      }
    }
  }, [period]);

  const fetchData = useCallback(async () => {
    if (!clinicId) return;
    setLoading(true);
    const { from, to } = getRange();

    const [snapRes, topRes, salariesDisplay, salariesDeducted, reviewFees, visitorDebt] =
      await Promise.all([
      supabase.rpc("get_clinic_financial_snapshot", {
        p_clinic_id: clinicId, p_from: from, p_to: to,
      }),
      supabase.rpc("get_top_performers", {
        p_clinic_id: clinicId,
        p_from: from,
        p_to: to,
      }),
      fetchPaidSalariesForDisplay(supabase, clinicId, from, to),
      fetchPaidSalariesForProfitDeduction(supabase, clinicId, from, to),
      fetchReviewFeesInPeriod(supabase, clinicId, from, to),
      fetchPeriodVisitorDebt(supabase, clinicId, from, to),
    ]);

    const baseSnap: Snapshot = snapRes.data
      ? (mergeExecutiveDashboardMetrics(
          snapRes.data as unknown as ExecutiveSnapshotCore,
          {
            salariesPaid: salariesDisplay,
            salariesDeductedFromProfit: salariesDeducted,
            reviewFees: reviewFees.total,
          }
        ) as unknown as Snapshot)
      : {
          revenue: 0,
          collected: 0,
          debt: 0,
          doctor_shares: 0,
          clinic_shares: 0,
          materials_cost: 0,
          expenses: 0,
          salaries_paid: salariesDisplay,
          review_fees: reviewFees.total,
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
      debt: visitorDebt.debt,
      patient_count:
        visitorDebt.visitorCount > 0
          ? visitorDebt.visitorCount
          : baseSnap.patient_count,
    });

    if (topRes.data) setTop(topRes.data as TopPerformers);
    setLoading(false);
  }, [clinicId, getRange, supabase]);

  useEffect(() => {
    if (clinicLoading || clinicId === undefined) return;
    if (!clinicId) {
      setLoading(false);
      return;
    }
    fetchData();
  }, [fetchData, clinicLoading, clinicId]);

  const PERIODS = [
    { key: "today" as Period, label: "اليوم"    },
    { key: "week"  as Period, label: "الأسبوع"  },
    { key: "month" as Period, label: "هذا الشهر"},
  ];

  return (
    <div className="space-y-6">

      {/* Period selector */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-bold text-slate-800">لوحة التحكم التنفيذية</h2>
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
              label="صافي الربح الحقيقي"
              value={`${fmt(snap.net_profit)} د.ع`}
              icon={TrendingUp}
              color={snap.net_profit >= 0 ? "bg-emerald-100 text-emerald-600" : "bg-red-100 text-red-600"}
              growth={snap.revenue_growth}
              highlight
            />
            <KpiCard
              label="إجمالي الإيرادات"
              value={`${fmt(snap.revenue)} د.ع`}
              sub={`محصّل: ${fmt(snap.collected)}`}
              icon={DollarSign}
              color="bg-blue-100 text-blue-600"
              growth={snap.revenue_growth}
            />
            <KpiCard
              label="ديون المراجعين"
              value={`${fmt(snap.debt)} د.ع`}
              sub={
                snap.debt > 0
                  ? `ذمة ${snap.patient_count} مراجع في الفترة`
                  : "لا ذمة لمراجعي هذه الفترة"
              }
              icon={Receipt}
              color="bg-amber-100 text-amber-600"
            />
            <KpiCard
              label="المصروفات"
              value={`${fmt(snap.expenses)} د.ع`}
              sub={
                (snap.salaries_paid ?? 0) > 0
                  ? `رواتب مُسلَّمة: ${fmt(snap.salaries_paid ?? 0)}`
                  : undefined
              }
              icon={Wallet}
              color="bg-red-100 text-red-500"
            />
            <KpiCard
              label="رواتب مُسلَّمة"
              value={`${fmt(snap.salaries_paid ?? 0)} د.ع`}
              sub="تُصفَّر بعد تصفير شهر الرواتب — الربح يبقى مخصوماً"
              icon={UserCog}
              color="bg-rose-100 text-rose-600"
            />
            <KpiCard
              label="كشفيات مراجع"
              value={`${fmt(snap.review_fees ?? 0)} د.ع`}
              sub="تُضاف عند تسجيل الجلسة — للعيادة فقط"
              icon={Receipt}
              color="bg-teal-100 text-teal-700"
            />
            <KpiCard
              label="المرضى المُعالَجون"
              value={String(snap.patient_count)}
              sub={`${snap.operation_count} عملية`}
              icon={Users}
              color="bg-violet-100 text-violet-600"
            />
            <KpiCard
              label="مرضى جدد"
              value={String(snap.new_patients)}
              icon={UserPlus}
              color="bg-pink-100 text-pink-600"
            />
            <KpiCard
              label="حصة العيادة الصافية"
              value={`${fmt(snap.clinic_shares)} د.ع`}
              sub="قبل المصروفات"
              icon={ArrowUpRight}
              color="bg-emerald-100 text-emerald-600"
            />
            <KpiCard
              label="أرباح الأطباء (محافظ)"
              value={`${fmt(snap.doctor_shares)} د.ع`}
              sub={`مسحوب: ${fmt(snap.withdrawals_paid)}`}
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
