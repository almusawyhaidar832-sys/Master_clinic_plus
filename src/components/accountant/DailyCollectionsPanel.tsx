"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader, CardTitle } from "@/components/ui/Card";
import { Alert } from "@/components/ui/Alert";
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
import { formatDoctorDisplayName } from "@/lib/services/clinic-profile";
import { cn, formatCurrency, formatDate, todayISO } from "@/lib/utils";
import {
  Calendar,
  ChevronDown,
  ChevronUp,
  Receipt,
  RefreshCw,
  Stethoscope,
  Users,
} from "lucide-react";

type DoctorOption = { id: string; full_name_ar: string };

const STATUS_TABS: { id: CollectionStatusFilter; label: string }[] = [
  { id: "all", label: "الكل" },
  { id: "paid", label: "دفعوا" },
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

  const showCollect =
    row.paymentStatus === "unpaid" ||
    row.paymentStatus === "partial" ||
    row.paymentStatus === "at_accountant";

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
              ✓ دفع {formatCurrency(row.visitPaidToday)} — مكتمل
            </p>
          )}
        <p className="mt-0.5 text-xs text-slate-muted">{row.sessionLabel}</p>
        {row.patientPhone && (
          <p className="mt-0.5 text-xs text-slate-muted" dir="ltr">
            {row.patientPhone}
          </p>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-4 sm:justify-end">
        <div className="text-right">
          <p className="text-[11px] text-slate-muted">دفع هذا اليوم</p>
          <p
            className={cn(
              "text-lg font-bold tabular-nums",
              row.visitPaidToday > 0 ? "text-success-text" : "text-slate-muted"
            )}
          >
            {formatCurrency(row.visitPaidToday)}
          </p>
          {row.paidToday > 0 &&
            row.paidToday !== row.visitPaidToday &&
            row.visitPaidToday > 0 && (
              <p className="mt-0.5 text-[10px] text-slate-muted">
                هذه الجلسة: {formatCurrency(row.paidToday)}
              </p>
            )}
          {row.requiredToday > 0 && (
            <p className="mt-0.5 text-[10px] text-slate-muted">
              مطلوب: {formatCurrency(row.requiredToday)}
            </p>
          )}
        </div>
        <div className="text-right">
          <p className="text-[11px] text-slate-muted">المتبقي</p>
          <p
            className={cn(
              "font-bold tabular-nums",
              row.remaining > 0 ? "text-debt-text" : "text-success-text"
            )}
          >
            {formatCurrency(row.remaining)}
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

function DoctorSection({
  doctorName,
  stats,
  rows,
  defaultOpen,
}: {
  doctorName: string;
  stats: DailyCollectionsResult["totals"];
  rows: DailyCollectionRow[];
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
              {stats.totalPatients} جلسة · محصّل{" "}
              {formatCurrency(stats.totalCollected)} · متبقي{" "}
              {formatCurrency(stats.totalRemaining)}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="hidden rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-800 sm:inline">
            {stats.paidFull + stats.partial} دفع
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
          {rows.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-slate-muted">
              لا مراجعين في هذا التصنيف
            </p>
          ) : (
            rows.map((row) => <PatientRow key={row.id} row={row} />)
          )}
        </div>
      )}
    </Card>
  );
}

export function DailyCollectionsPanel() {
  const { clinicId, loading: clinicLoading } = useActiveClinicId();
  const [date, setDate] = useState(todayISO());
  const [doctorId, setDoctorId] = useState("");
  const [statusFilter, setStatusFilter] =
    useState<CollectionStatusFilter>("all");
  const [doctors, setDoctors] = useState<DoctorOption[]>([]);
  const [result, setResult] = useState<DailyCollectionsResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [appliedDate, setAppliedDate] = useState(todayISO());

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

  const loadCollections = useCallback(async () => {
    if (!clinicId) {
      setResult(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    const supabase = createClient();
    const data = await fetchDailyCollections(supabase, clinicId, {
      date,
      doctorId: doctorId || undefined,
      statusFilter,
    });
    setResult(data);
    setAppliedDate(date);
    setLoading(false);
  }, [clinicId, date, doctorId, statusFilter]);

  useEffect(() => {
    if (clinicLoading) return;
    void loadDoctors();
  }, [loadDoctors, clinicLoading]);

  useEffect(() => {
    if (clinicLoading) return;
    void loadCollections();
  }, [loadCollections, clinicLoading]);

  useClinicSync({
    topics: ["sessions"],
    clinicId,
    onRefresh: loadCollections,
    enabled: !clinicLoading && !!clinicId,
  });

  const dateLabel = useMemo(
    () => formatDate(new Date(appliedDate + "T12:00:00")),
    [appliedDate]
  );

  return (
    <div className="space-y-6">
      <div>
        <h2 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-slate-text">
          <span className="mc-icon-badge-primary">
            <Calendar className="h-5 w-5" />
          </span>
          كشف التحصيل اليومي
        </h2>
        <p className="mc-page-subtitle">
          مراجعين كل طبيب — من دفع ومن لم يدفع — حسب التاريخ
        </p>
      </div>

      <Card>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Input
            label="التاريخ"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
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
          <div className="flex items-end sm:col-span-2 lg:col-span-2">
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
          </div>
        </div>

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
              ملخص {dateLabel}
            </CardTitle>
          </CardHeader>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <SummaryChip label="جلسات" value={result.totals.totalPatients} />
            <SummaryChip
              label="دفعوا"
              value={result.totals.paidFull + result.totals.partial}
              className="border-emerald-200 bg-emerald-50/50"
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
              label="محصّل"
              value={formatCurrency(result.totals.totalCollected)}
            />
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
          لا توجد بيانات تحصيل لـ {dateLabel}
          {doctorId ? " لهذا الطبيب" : ""}.
        </Alert>
      )}

      {!loading &&
        result?.doctors.map((group, index) => (
          <DoctorSection
            key={group.doctorId}
            doctorName={group.doctorName}
            stats={group.stats}
            rows={group.rows}
            defaultOpen={index === 0 || !!doctorId}
          />
        ))}
    </div>
  );
}
