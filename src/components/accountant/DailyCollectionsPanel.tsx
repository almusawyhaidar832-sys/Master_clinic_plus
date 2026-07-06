"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader, CardTitle } from "@/components/ui/Card";
import { Alert } from "@/components/ui/Alert";
import { authPortalHeaders } from "@/lib/auth/api-portal";
import { createClient } from "@/lib/supabase/client";
import { useActiveClinicId } from "@/hooks/useActiveClinicId";
import { useClinicSync } from "@/hooks/useClinicSync";
import { buildLedgerPayUrl } from "@/lib/ledger/navigation";
import {
  collectionStatusClass,
  collectionStatusLabel,
  fetchDailyCollections,
  type CollectionStatusFilter,
  type DailyCollectionsResult,
  type DailyCollectionRow,
} from "@/lib/ledger/daily-collections";
import type { DailyAssistantPayrollLine } from "@/lib/ledger/daily-assistant-payroll";
import { OutstandingDebtPanel } from "@/components/accountant/OutstandingDebtPanel";
import { formatDoctorDisplayName } from "@/lib/services/clinic-profile";
import { FINANCIAL_EPSILON } from "@/lib/services/patient-financial-plan";
import { cn, formatCurrency, formatDate, todayISO, addDaysISO } from "@/lib/utils";
import {
  Calendar,
  ChevronDown,
  ChevronUp,
  Receipt,
  RefreshCw,
  Stethoscope,
  UserRound,
  Users,
} from "lucide-react";

type DoctorOption = { id: string; full_name_ar: string };

const STATUS_TABS: { id: CollectionStatusFilter; label: string }[] = [
  { id: "all", label: "الكل" },
  { id: "paid", label: "دفعوا" },
  { id: "debtors", label: "مديونين" },
  { id: "unpaid", label: "لم يدفعوا" },
  { id: "at_accountant", label: "عند المحاسب" },
];

function SummaryChip({
  label,
  value,
  className,
}: {
  label: string;
  value: number | string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-xl border border-slate-border bg-surface px-3 py-2 text-center",
        className
      )}
    >
      <p className="text-lg font-bold tabular-nums text-slate-text">{value}</p>
      <p className="text-[11px] text-slate-muted">{label}</p>
    </div>
  );
}

function PatientRow({ row }: { row: DailyCollectionRow }) {
  const payUrl = buildLedgerPayUrl({
    patientId: row.patientId,
    doctorId: row.doctorId,
    queueEntryId: row.queueEntryId,
    patientName: row.patientName,
    patientPhone: row.patientPhone,
  });

  const debtAmount = Math.max(row.caseDebtTotal, row.remaining);
  const reviewFeePaidToday =
    row.sessionLabel.includes("كشفية") &&
    row.visitPaidToday > FINANCIAL_EPSILON &&
    row.requiredToday <= FINANCIAL_EPSILON;

  const showCollect =
    !reviewFeePaidToday &&
    (row.paymentStatus === "unpaid" ||
      row.paymentStatus === "partial" ||
      row.paymentStatus === "at_accountant" ||
      row.paymentStatus === "debtor");

  return (
    <div className="flex flex-col gap-3 border-b border-slate-border/60 px-4 py-3 last:border-b-0 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-semibold text-slate-text">{row.patientName}</p>
          <span
            className={cn(
              "inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium",
              collectionStatusClass(row.paymentStatus)
            )}
          >
            {collectionStatusLabel(row.paymentStatus)}
          </span>
        </div>
          {row.paymentStatus === "paid_full" && row.visitPaidToday > 0 && (
            <p className="mt-1 text-xs font-semibold text-emerald-700">
              ✓ دفع {formatCurrency(row.visitPaidToday)}
              {row.visitDoctorShare > 0 &&
                ` · حصة الطبيب ${formatCurrency(row.visitDoctorShare)}`}
            </p>
          )}
          {(row.paymentStatus === "partial" ||
            (row.paymentStatus === "debtor" && row.visitPaidToday > 0)) &&
            row.visitDoctorShare > 0 && (
              <p className="mt-1 text-xs text-primary tabular-nums">
                حصة الطبيب من المدفوع: {formatCurrency(row.visitDoctorShare)}
              </p>
            )}
          {row.paymentStatus === "debtor" && debtAmount > 0 && (
            <p className="mt-1 text-xs font-bold text-debt-text tabular-nums">
              دين مسجّل: {formatCurrency(debtAmount)}
              {row.visitPaidToday > 0 &&
                ` · دفع اليوم: ${formatCurrency(row.visitPaidToday)}`}
            </p>
          )}
          {row.debtCases.length > 0 && (
            <p className="mt-0.5 text-[11px] text-slate-muted">
              {row.debtCases
                .map((c) => `${c.treatmentName}: ${formatCurrency(c.debt)}`)
                .join(" · ")}
            </p>
          )}
        <p className="mt-0.5 text-xs text-slate-muted">{row.sessionLabel}</p>
        {row.visitDate && (
          <p className="mt-0.5 text-[11px] text-slate-muted">
            {formatDate(new Date(row.visitDate + "T12:00:00"))}
          </p>
        )}
        {row.patientPhone && (
          <p className="mt-0.5 text-xs text-slate-muted" dir="ltr">
            {row.patientPhone}
          </p>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-4 sm:justify-end">
        {row.requiredToday > FINANCIAL_EPSILON && (
          <div className="text-right">
            <p className="text-[11px] text-slate-muted">السعر الكلي</p>
            <p className="font-bold tabular-nums text-slate-text">
              {formatCurrency(row.requiredToday)}
            </p>
          </div>
        )}
        <div className="text-right">
          <p className="text-[11px] text-slate-muted">ما دفعه المراجع</p>
          <p
            className={cn(
              "text-lg font-bold tabular-nums",
              row.visitPaidToday > 0 ? "text-success-text" : "text-slate-muted"
            )}
          >
            {formatCurrency(row.visitPaidToday)}
          </p>
        </div>
        <div className="text-right">
          <p className="text-[11px] text-slate-muted">حصة الطبيب</p>
          <p
            className={cn(
              "text-lg font-bold tabular-nums",
              row.visitDoctorShare > 0 ? "text-primary" : "text-slate-muted"
            )}
          >
            {formatCurrency(row.visitDoctorShare)}
          </p>
        </div>
        <div className="text-right">
          <p className="text-[11px] text-slate-muted">
            {row.paymentStatus === "debtor" ? "الدين" : "المتبقي"}
          </p>
          <p
            className={cn(
              "font-bold tabular-nums",
              debtAmount > 0 ? "text-debt-text" : "text-success-text"
            )}
          >
            {formatCurrency(debtAmount)}
          </p>
        </div>
        <div className="flex gap-2">
          {row.patientId && (
            <Link
              href={`/dashboard/patients/${row.patientId}`}
              className="rounded-lg border border-slate-border px-3 py-1.5 text-xs font-medium text-slate-text hover:bg-surface"
            >
              الملف
            </Link>
          )}
          {showCollect && (
            <Link
              href={payUrl}
              className="inline-flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-white hover:bg-primary/90"
            >
              <Receipt className="h-3.5 w-3.5" />
              تحصيل
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}

function AssistantPayrollRow({ line }: { line: DailyAssistantPayrollLine }) {
  const isConfirmed = line.statusLabel === "صرف مؤكّد";

  return (
    <div className="flex flex-col gap-3 border-b border-slate-border/60 bg-amber-50/30 px-4 py-3 last:border-b-0 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <UserRound className="h-4 w-4 shrink-0 text-amber-700" />
          <p className="font-semibold text-slate-text">
            مساعد: {line.assistantName}
          </p>
          <span
            className={cn(
              "inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium",
              isConfirmed
                ? "bg-emerald-100 text-emerald-800"
                : "bg-amber-100 text-amber-900"
            )}
          >
            {line.statusLabel}
          </span>
        </div>
        <p className="mt-1 text-xs text-slate-muted">
          نسبة الطبيب من الأجر: {line.doctorSharePct}%
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-4 sm:justify-end">
        <div className="text-right">
          <p className="text-[11px] text-slate-muted">أجر المساعد</p>
          <p className="font-bold tabular-nums text-slate-text">
            {formatCurrency(line.totalSalary)}
          </p>
        </div>
        <div className="text-right">
          <p className="text-[11px] text-slate-muted">يُخصم من الطبيب</p>
          <p className="font-bold tabular-nums text-red-700">
            − {formatCurrency(line.doctorDeduction)}
          </p>
        </div>
        <div className="text-right">
          <p className="text-[11px] text-slate-muted">حصة العيادة</p>
          <p className="font-bold tabular-nums text-slate-text">
            {formatCurrency(line.clinicShare)}
          </p>
        </div>
      </div>
    </div>
  );
}

function DoctorSection({
  doctorName,
  stats,
  rows,
  assistantPayroll,
  defaultOpen,
}: {
  doctorName: string;
  stats: DailyCollectionsResult["totals"];
  rows: DailyCollectionRow[];
  assistantPayroll: DailyAssistantPayrollLine[];
  defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <Card className="overflow-hidden p-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 px-5 py-4 text-right hover:bg-surface/60"
      >
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <span className="mc-icon-badge-primary shrink-0">
            <Stethoscope className="h-4 w-4" />
          </span>
          <div className="min-w-0 text-right">
            <p className="truncate font-bold text-slate-text">
              {formatDoctorDisplayName(doctorName)}
            </p>
            <p className="mt-0.5 text-xs text-slate-muted">
              {stats.totalPatients > 0 && (
                <>
                  {stats.totalPatients} مراجع · مدفوع{" "}
                  {formatCurrency(stats.totalCollected)}
                  {stats.doctorShareToday > 0 && (
                    <>
                      {" "}
                      · حصة {formatCurrency(stats.doctorShareToday)}
                    </>
                  )}
                  {" "}
                  · متبقي {formatCurrency(stats.totalRemaining)}
                </>
              )}
              {stats.totalPatients === 0 && assistantPayroll.length > 0 && (
                <>أجور مساعدين فقط</>
              )}
              {stats.assistantDoctorDeduction > 0 && (
                <>
                  {stats.totalPatients > 0 && " · "}
                  خصم مساعدين −{formatCurrency(stats.assistantDoctorDeduction)}
                  {stats.netDoctorShareToday >= 0 && (
                    <> · صافي {formatCurrency(stats.netDoctorShareToday)}</>
                  )}
                </>
              )}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="hidden rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-800 sm:inline">
            {stats.paidFull + stats.partial} دفع
          </span>
          <span className="hidden rounded-full bg-orange-100 px-2 py-0.5 text-[11px] font-bold text-orange-900 sm:inline">
            {stats.debtors} مديون
          </span>
          <span className="hidden rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-medium text-red-700 sm:inline">
            {stats.unpaid} لم يدفع
          </span>
          <span className="hidden rounded-full bg-violet-100 px-2 py-0.5 text-[11px] font-medium text-violet-800 sm:inline">
            {stats.atAccountant} عند المحاسب
          </span>
          {open ? (
            <ChevronUp className="h-5 w-5 text-slate-muted" />
          ) : (
            <ChevronDown className="h-5 w-5 text-slate-muted" />
          )}
        </div>
      </button>

      {open && (
        <div className="border-t border-slate-border bg-surface-card">
          {rows.length === 0 && assistantPayroll.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-slate-muted">
              لا مراجعين في هذا التصنيف
            </p>
          ) : (
            <>
              {rows.map((row) => (
                <PatientRow key={row.id} row={row} />
              ))}
              {assistantPayroll.length > 0 && (
                <div className="border-t border-amber-200/60">
                  <p className="bg-amber-50/60 px-4 py-2 text-xs font-semibold text-amber-900">
                    أجور مساعدي الطبيب
                  </p>
                  {assistantPayroll.map((line) => (
                    <AssistantPayrollRow key={line.id} line={line} />
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </Card>
  );
}

export function DailyCollectionsPanel() {
  const { clinicId, loading: clinicLoading } = useActiveClinicId();
  const [dateFrom, setDateFrom] = useState(todayISO());
  const [dateTo, setDateTo] = useState(todayISO());
  const [doctorId, setDoctorId] = useState("");
  const [statusFilter, setStatusFilter] =
    useState<CollectionStatusFilter>("all");
  const [doctors, setDoctors] = useState<DoctorOption[]>([]);
  const [result, setResult] = useState<DailyCollectionsResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [repairMsg, setRepairMsg] = useState<string | null>(null);
  const [repairing, setRepairing] = useState(false);
  const [appliedFrom, setAppliedFrom] = useState(todayISO());
  const [appliedTo, setAppliedTo] = useState(todayISO());

  const effectiveTo = dateTo >= dateFrom ? dateTo : dateFrom;

  const loadDoctors = useCallback(async () => {
    if (!clinicId) {
      setDoctors([]);
      return;
    }
    const supabase = createClient();
    const { data } = await supabase
      .from("doctors")
      .select("id, full_name_ar")
      .eq("clinic_id", clinicId)
      .eq("is_active", true)
      .order("full_name_ar");
    setDoctors((data as DoctorOption[]) ?? []);
  }, [clinicId]);

  const selectedDoctorId = doctorId.trim() || undefined;

  const loadCollections = useCallback(async () => {
    if (!clinicId) {
      setResult(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    const supabase = createClient();
    const data = await fetchDailyCollections(supabase, clinicId, {
      dateFrom,
      dateTo: effectiveTo,
      doctorId: selectedDoctorId,
      statusFilter,
    });
    setResult(data);
    setAppliedFrom(dateFrom);
    setAppliedTo(effectiveTo);
    setLoading(false);
  }, [clinicId, dateFrom, effectiveTo, selectedDoctorId, statusFilter]);

  useEffect(() => {
    if (clinicLoading) return;
    void loadDoctors();
  }, [loadDoctors, clinicLoading]);

  useEffect(() => {
    if (clinicLoading) return;
    void loadCollections();
  }, [loadCollections, clinicLoading]);

  useClinicSync({
    topics: ["sessions", "financial"],
    clinicId,
    onRefresh: loadCollections,
    enabled: !clinicLoading && !!clinicId,
  });

  const periodLabel = useMemo(() => {
    if (appliedFrom === appliedTo) {
      return formatDate(new Date(appliedFrom + "T12:00:00"));
    }
    return `${formatDate(new Date(appliedFrom + "T12:00:00"))} — ${formatDate(new Date(appliedTo + "T12:00:00"))}`;
  }, [appliedFrom, appliedTo]);

  const setToday = () => {
    const today = todayISO();
    setDateFrom(today);
    setDateTo(today);
  };

  const setLast7Days = () => {
    const today = todayISO();
    setDateFrom(addDaysISO(today, -6));
    setDateTo(today);
  };

  const repairDoctorShares = useCallback(async () => {
    if (!selectedDoctorId) return;
    setRepairing(true);
    setRepairMsg(null);
    try {
      const res = await fetch("/api/admin/repair-doctor-shares", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...authPortalHeaders("accountant"),
        },
        body: JSON.stringify({ doctorId: selectedDoctorId }),
      });
      const data = (await res.json()) as { message?: string; error?: string };
      if (!res.ok) {
        setRepairMsg(data.error ?? "تعذر إصلاح الحصص");
        return;
      }
      setRepairMsg(data.message ?? "تم الإصلاح");
      await loadCollections();
    } catch {
      setRepairMsg("تعذر الاتصال بالخادم");
    } finally {
      setRepairing(false);
    }
  }, [selectedDoctorId, loadCollections]);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-slate-text">
          <span className="mc-icon-badge-primary">
            <Calendar className="h-5 w-5" />
          </span>
          كشف مالي
        </h2>
        <p className="mc-page-subtitle">
          لكل مراجع: ما دفعه، حصة الطبيب من المدفوع، والمتبقي. الملخص =
          مجموع الفترة المحددة — مو الرصيد التراكمي للطبيب.
        </p>
      </div>

      <Card>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Input
            label="من تاريخ"
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            dir="ltr"
            className="text-left"
          />
          <Input
            label="إلى تاريخ"
            type="date"
            value={dateTo}
            min={dateFrom}
            onChange={(e) => setDateTo(e.target.value)}
            dir="ltr"
            className="text-left"
          />
          <Select
            label="الطبيب"
            value={doctorId}
            onChange={(e) => setDoctorId(e.target.value)}
            placeholder="كل الأطباء"
            options={doctors.map((d) => ({
              value: d.id,
              label: d.full_name_ar,
            }))}
          />
          <div className="flex flex-wrap items-end gap-2 sm:col-span-2 lg:col-span-1">
            <Button
              type="button"
              onClick={() => void loadCollections()}
              disabled={loading}
              className="w-full sm:w-auto"
            >
              {loading ? (
                <RefreshCw className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              <span className="mr-2">تحديث</span>
            </Button>
            {selectedDoctorId && (
              <Button
                type="button"
                variant="outline"
                onClick={() => void repairDoctorShares()}
                disabled={loading || repairing}
                className="w-full sm:w-auto"
              >
                {repairing ? (
                  <RefreshCw className="h-4 w-4 animate-spin" />
                ) : (
                  <Stethoscope className="h-4 w-4" />
                )}
                <span className="mr-2">إصلاح حصص الطبيب (كل الجلسات)</span>
              </Button>
            )}
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={setToday}
            className="rounded-full border border-slate-border px-3 py-1 text-xs font-medium text-slate-muted hover:bg-surface"
          >
            اليوم
          </button>
          <button
            type="button"
            onClick={setLast7Days}
            className="rounded-full border border-slate-border px-3 py-1 text-xs font-medium text-slate-muted hover:bg-surface"
          >
            آخر 7 أيام
          </button>
        </div>

        {repairMsg && (
          <Alert
            variant={repairMsg.includes("تعذر") ? "error" : "success"}
            className="mt-4"
          >
            {repairMsg}
          </Alert>
        )}

        <div className="mt-4 flex flex-wrap gap-2">
          {STATUS_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setStatusFilter(tab.id)}
              className={cn(
                "rounded-full px-4 py-1.5 text-sm font-medium transition-colors",
                statusFilter === tab.id
                  ? "bg-primary text-white"
                  : "bg-surface text-slate-muted hover:bg-surface/80"
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </Card>

      {result && !loading && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Users className="h-4 w-4 text-primary" />
              ملخص {periodLabel}
            </CardTitle>
          </CardHeader>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-10">
            <SummaryChip label="جلسات" value={result.totals.totalPatients} />
            <SummaryChip
              label="دفعوا"
              value={result.totals.paidFull + result.totals.partial}
              className="border-emerald-200 bg-emerald-50/50"
            />
            <SummaryChip
              label="مديونين"
              value={result.totals.debtors}
              className="border-orange-200 bg-orange-50/50"
            />
            <SummaryChip
              label="لم يدفعوا"
              value={result.totals.unpaid}
              className="border-red-200 bg-red-50/50"
            />
            <SummaryChip
              label="عند المحاسب"
              value={result.totals.atAccountant}
              className="border-violet-200 bg-violet-50/50"
            />
            <SummaryChip
              label="مدفوع المراجعين"
              value={formatCurrency(result.totals.totalCollected)}
            />
            <SummaryChip
              label="حصة الأطباء"
              value={formatCurrency(result.totals.doctorShareToday)}
              className="border-primary/30 bg-primary/5"
            />
            {result.totals.assistantDoctorDeduction > 0 && (
              <SummaryChip
                label="خصم مساعدين"
                value={`− ${formatCurrency(result.totals.assistantDoctorDeduction)}`}
                className="border-red-200 bg-red-50/50"
              />
            )}
            {result.totals.netDoctorShareToday > 0 && (
              <SummaryChip
                label="صافي حصة الأطباء"
                value={formatCurrency(result.totals.netDoctorShareToday)}
                className="border-emerald-300 bg-emerald-50/70"
              />
            )}
            <SummaryChip
              label="متبقي"
              value={formatCurrency(result.totals.totalRemaining)}
              className="border-amber-200 bg-amber-50/50"
            />
          </div>
        </Card>
      )}

      {loading && (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-20 animate-pulse rounded-xl bg-surface"
            />
          ))}
        </div>
      )}

      {!loading && result && result.doctors.length === 0 && (
        <Alert variant="info">
          لا توجد بيانات مالية لـ {periodLabel}
          {doctorId ? " لهذا الطبيب" : ""}.
        </Alert>
      )}

      {!loading && result && result.doctors.length > 0 && !selectedDoctorId && (
        <p className="text-sm font-medium text-slate-muted">
          {result.doctors.length} طبيب في هذه الفترة
        </p>
      )}

      {!loading &&
        result?.doctors.map((group, index) => (
          <DoctorSection
            key={group.doctorId}
            doctorName={group.doctorName}
            stats={group.stats}
            rows={group.rows}
            assistantPayroll={group.assistantPayroll}
            defaultOpen={!!selectedDoctorId || index < 5}
          />
        ))}

      {!loading && clinicId && (
        <OutstandingDebtPanel clinicId={clinicId} doctorId={selectedDoctorId} />
      )}
    </div>
  );
}
