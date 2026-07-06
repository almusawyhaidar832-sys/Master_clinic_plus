"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader, CardTitle } from "@/components/ui/Card";
import { Alert } from "@/components/ui/Alert";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { createClient } from "@/lib/supabase/client";
import { useActiveClinicId } from "@/hooks/useActiveClinicId";
import { useClinicSync } from "@/hooks/useClinicSync";
import {
  collectionStatusClass,
  collectionStatusLabel,
  fetchDailyCollections,
  type CollectionStatusFilter,
  type DailyCollectionRow,
  type DailyCollectionsResult,
} from "@/lib/ledger/daily-collections";
import { formatDoctorDisplayName } from "@/lib/services/clinic-profile";
import { FINANCIAL_EPSILON } from "@/lib/services/patient-financial-plan";
import { getPatientDisplayPhone, phoneToLocalDisplay } from "@/lib/phone";
import {
  cn,
  formatCurrency,
  formatDate,
  todayISO,
  addDaysISO,
} from "@/lib/utils";
import { Calendar, RefreshCw, Users } from "lucide-react";

type DoctorOption = { id: string; full_name_ar: string };

const STATUS_TABS: { id: CollectionStatusFilter; label: string }[] = [
  { id: "all", label: "الكل" },
  { id: "paid", label: "دفعوا" },
  { id: "debtors", label: "مديونين" },
  { id: "unpaid", label: "لم يدفعوا" },
  { id: "at_accountant", label: "عند المحاسب" },
];

function formatVisitPhone(raw: string | null | undefined): string | null {
  if (!raw?.trim()) return null;
  return phoneToLocalDisplay(raw) || raw.trim();
}

async function enrichPatientPhones(
  rows: DailyCollectionRow[]
): Promise<DailyCollectionRow[]> {
  const patientIds = [
    ...new Set(
      rows
        .filter((r) => r.patientId)
        .map((r) => r.patientId as string)
    ),
  ];
  if (patientIds.length === 0) {
    return rows.map((r) => ({
      ...r,
      patientPhone: formatVisitPhone(r.patientPhone),
    }));
  }

  const supabase = createClient();
  const { data } = await supabase
    .from("patients")
    .select("id, phone, phone_number")
    .in("id", patientIds);

  const phoneById = new Map<string, string>();
  for (const row of data ?? []) {
    const phone = getPatientDisplayPhone(
      row as { phone?: string | null; phone_number?: string | null }
    );
    if (phone) phoneById.set(String(row.id), phone);
  }

  return rows.map((r) => {
    const fromRecord = r.patientId ? phoneById.get(r.patientId) : undefined;
    const phone = r.patientPhone?.trim() || fromRecord || null;
    return {
      ...r,
      patientPhone: formatVisitPhone(phone),
    };
  });
}

function flattenVisitRows(result: DailyCollectionsResult): DailyCollectionRow[] {
  const groupByDay = result.dateFrom !== result.dateTo;
  const rows = result.doctors.flatMap((g) => g.rows);

  return rows.sort((a, b) => {
    if (groupByDay) {
      const dateCmp = String(b.visitDate ?? "").localeCompare(
        String(a.visitDate ?? "")
      );
      if (dateCmp !== 0) return dateCmp;
    }
    const paidCmp = b.visitPaidToday - a.visitPaidToday;
    if (paidCmp !== 0) return paidCmp;
    return a.patientName.localeCompare(b.patientName, "ar");
  });
}

export function PatientDailyVisitsPanel() {
  const { clinicId, loading: clinicLoading } = useActiveClinicId();
  const [dateFrom, setDateFrom] = useState(todayISO());
  const [dateTo, setDateTo] = useState(todayISO());
  const [doctorId, setDoctorId] = useState("");
  const [statusFilter, setStatusFilter] =
    useState<CollectionStatusFilter>("all");
  const [doctors, setDoctors] = useState<DoctorOption[]>([]);
  const [result, setResult] = useState<DailyCollectionsResult | null>(null);
  const [rows, setRows] = useState<DailyCollectionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [appliedFrom, setAppliedFrom] = useState(todayISO());
  const [appliedTo, setAppliedTo] = useState(todayISO());
  const [nameFilter, setNameFilter] = useState("");

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

  const loadVisits = useCallback(async () => {
    if (!clinicId) {
      setResult(null);
      setRows([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const supabase = createClient();
    const data = await fetchDailyCollections(supabase, clinicId, {
      dateFrom,
      dateTo: effectiveTo,
      doctorId: doctorId || undefined,
      statusFilter,
    });
    const flat = flattenVisitRows(data);
    const enriched = await enrichPatientPhones(flat);
    setResult(data);
    setRows(enriched);
    setAppliedFrom(dateFrom);
    setAppliedTo(effectiveTo);
    setLoading(false);
  }, [clinicId, dateFrom, effectiveTo, doctorId, statusFilter]);

  useEffect(() => {
    if (clinicLoading) return;
    void loadDoctors();
  }, [loadDoctors, clinicLoading]);

  useEffect(() => {
    if (clinicLoading) return;
    void loadVisits();
  }, [loadVisits, clinicLoading]);

  useClinicSync({
    topics: ["sessions", "financial"],
    clinicId,
    onRefresh: loadVisits,
    enabled: !clinicLoading && !!clinicId,
  });

  const periodLabel = useMemo(() => {
    if (appliedFrom === appliedTo) {
      return formatDate(new Date(appliedFrom + "T12:00:00"));
    }
    return `${formatDate(new Date(appliedFrom + "T12:00:00"))} — ${formatDate(new Date(appliedTo + "T12:00:00"))}`;
  }, [appliedFrom, appliedTo]);

  const filteredRows = useMemo(() => {
    const q = nameFilter.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => {
      const name = r.patientName.toLowerCase();
      const phone = (r.patientPhone ?? "").toLowerCase();
      return name.includes(q) || phone.includes(q);
    });
  }, [rows, nameFilter]);

  const setToday = () => {
    const today = todayISO();
    setDateFrom(today);
    setDateTo(today);
  };

  const setYesterday = () => {
    const yesterday = addDaysISO(todayISO(), -1);
    setDateFrom(yesterday);
    setDateTo(yesterday);
  };

  const setLast7Days = () => {
    const today = todayISO();
    setDateFrom(addDaysISO(today, -6));
    setDateTo(today);
  };

  const columns: Column<DailyCollectionRow>[] = useMemo(
    () => [
      ...(appliedFrom !== appliedTo
        ? [
            {
              key: "date",
              header: "التاريخ",
              render: (row: DailyCollectionRow) =>
                row.visitDate ? (
                  <span className="text-xs text-slate-muted">
                    {formatDate(new Date(row.visitDate + "T12:00:00"))}
                  </span>
                ) : (
                  "—"
                ),
            },
          ]
        : []),
      {
        key: "patient",
        header: "المراجع",
        render: (row) => (
          <p className="font-semibold text-slate-text">{row.patientName}</p>
        ),
      },
      {
        key: "phone",
        header: "الهاتف",
        className: "whitespace-nowrap",
        render: (row) =>
          row.patientPhone ? (
            <span className="font-medium tabular-nums text-slate-text" dir="ltr">
              {row.patientPhone}
            </span>
          ) : (
            <span className="text-slate-400">—</span>
          ),
      },
      {
        key: "doctor",
        header: "الطبيب",
        render: (row) => (
          <span className="text-slate-700">
            {formatDoctorDisplayName(row.doctorName)}
          </span>
        ),
      },
      {
        key: "session",
        header: "العلاج / الجلسة",
        render: (row) => (
          <span className="text-slate-700">{row.sessionLabel}</span>
        ),
      },
      {
        key: "paid",
        header: "ما دفع",
        render: (row) => (
          <span
            className={cn(
              "font-bold tabular-nums",
              row.visitPaidToday > 0 ? "text-success-text" : "text-slate-muted"
            )}
          >
            {formatCurrency(row.visitPaidToday)}
          </span>
        ),
      },
      {
        key: "remaining",
        header: "المتبقي",
        render: (row) => {
          const debt = Math.max(row.caseDebtTotal, row.remaining);
          return (
            <span
              className={cn(
                "font-semibold tabular-nums",
                debt > FINANCIAL_EPSILON ? "text-debt-text" : "text-success-text"
              )}
            >
              {formatCurrency(debt)}
            </span>
          );
        },
      },
      {
        key: "status",
        header: "الحالة",
        render: (row) => (
          <span
            className={cn(
              "inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium",
              collectionStatusClass(row.paymentStatus)
            )}
          >
            {collectionStatusLabel(row.paymentStatus)}
          </span>
        ),
      },
      {
        key: "profile",
        header: "",
        render: (row) =>
          row.patientId ? (
            <Link
              href={`/dashboard/patients/${row.patientId}`}
              className="text-xs font-medium text-primary hover:underline"
            >
              الملف
            </Link>
          ) : (
            <span className="text-xs text-slate-muted">—</span>
          ),
      },
    ],
    [appliedFrom, appliedTo]
  );

  return (
    <div className="space-y-5">
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
          <div className="flex items-end">
            <Button
              type="button"
              onClick={() => void loadVisits()}
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
            onClick={setYesterday}
            className="rounded-full border border-slate-border px-3 py-1 text-xs font-medium text-slate-muted hover:bg-surface"
          >
            أمس
          </button>
          <button
            type="button"
            onClick={setLast7Days}
            className="rounded-full border border-slate-border px-3 py-1 text-xs font-medium text-slate-muted hover:bg-surface"
          >
            آخر 7 أيام
          </button>
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

        <div className="mt-4">
          <Input
            label="بحث في الجدول"
            type="text"
            value={nameFilter}
            onChange={(e) => setNameFilter(e.target.value)}
            placeholder="اسم المراجع أو رقم الهاتف..."
          />
        </div>
      </Card>

      {result && !loading && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Users className="h-4 w-4 text-primary" />
              زيارات {periodLabel}
            </CardTitle>
          </CardHeader>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-xl border border-slate-border bg-surface px-3 py-2 text-center">
              <p className="text-lg font-bold tabular-nums text-slate-text">
                {result.totals.totalPatients}
              </p>
              <p className="text-[11px] text-slate-muted">مراجع</p>
            </div>
            <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 px-3 py-2 text-center">
              <p className="text-lg font-bold tabular-nums text-emerald-800">
                {formatCurrency(result.totals.totalCollected)}
              </p>
              <p className="text-[11px] text-slate-muted">مدفوع</p>
            </div>
            <div className="rounded-xl border border-orange-200 bg-orange-50/50 px-3 py-2 text-center">
              <p className="text-lg font-bold tabular-nums text-orange-900">
                {result.totals.debtors}
              </p>
              <p className="text-[11px] text-slate-muted">مديونين</p>
            </div>
            <div className="rounded-xl border border-amber-200 bg-amber-50/50 px-3 py-2 text-center">
              <p className="text-lg font-bold tabular-nums text-amber-900">
                {formatCurrency(result.totals.totalRemaining)}
              </p>
              <p className="text-[11px] text-slate-muted">متبقي</p>
            </div>
          </div>
        </Card>
      )}

      {loading && (
        <div className="space-y-2">
          {[1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className="h-12 animate-pulse rounded-xl bg-surface"
            />
          ))}
        </div>
      )}

      {!loading && filteredRows.length === 0 && (
        <Alert variant="info">
          لا توجد زيارات لـ {periodLabel}
          {doctorId ? " لهذا الطبيب" : ""}.
        </Alert>
      )}

      {!loading && filteredRows.length > 0 && (
        <DataTable
          columns={columns}
          data={filteredRows}
          emptyMessage="لا توجد زيارات"
          highlightDebt={(row) =>
            Math.max(row.caseDebtTotal, row.remaining) > FINANCIAL_EPSILON
          }
        />
      )}
    </div>
  );
}
