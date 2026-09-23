"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { StatTile } from "@/components/ui/StatTile";
import { useLanguage } from "@/contexts/LanguageContext";
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
import {
  Hourglass,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Users,
  UserX,
  Wallet,
} from "lucide-react";

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
  const { bi } = useLanguage();
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
            <span className="text-slate-muted">—</span>
          ),
      },
      {
        key: "doctor",
        header: "الطبيب",
        render: (row) => (
          <span className="text-slate-text">
            {formatDoctorDisplayName(row.doctorName)}
          </span>
        ),
      },
      {
        key: "session",
        header: "العلاج / الجلسة",
        render: (row) => (
          <span className="text-slate-muted">{row.sessionLabel}</span>
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
              className="inline-flex items-center gap-1 rounded-lg border border-slate-border bg-surface-card px-2.5 py-1 text-xs font-semibold text-primary-700 shadow-card transition-colors hover:border-premium-300 dark:text-primary-300"
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
      <section className="mc-panel">
        <div className="mc-panel-head">
          <h3 className="mc-panel-title">
            <SlidersHorizontal />
            {bi("تصفية الزيارات", "Filter visits")}
          </h3>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={setToday} className="mc-chip px-3 py-1 text-xs">
              اليوم
            </button>
            <button type="button" onClick={setYesterday} className="mc-chip px-3 py-1 text-xs">
              أمس
            </button>
            <button type="button" onClick={setLast7Days} className="mc-chip px-3 py-1 text-xs">
              آخر 7 أيام
            </button>
          </div>
        </div>
        <div className="mc-panel-body space-y-4">
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
              <span className="ms-1">تحديث</span>
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 border-t border-slate-border pt-4">
          {STATUS_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setStatusFilter(tab.id)}
              className={cn("mc-chip", statusFilter === tab.id && "mc-chip--active")}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="relative">
          <label className="mc-label mb-1.5 block">بحث في الجدول</label>
          <div className="relative">
            <Search className="pointer-events-none absolute start-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-premium-500" />
            <input
              type="text"
              className="mc-field ps-10"
              value={nameFilter}
              onChange={(e) => setNameFilter(e.target.value)}
              placeholder="اسم المراجع أو رقم الهاتف..."
            />
          </div>
        </div>
        </div>
      </section>

      {result && !loading && (
        <div className="space-y-3 animate-fade-in">
          <div className="flex items-center gap-2 px-1">
            <Users className="h-4 w-4 text-premium-500" />
            <h3 className="text-sm font-bold text-slate-text">زيارات {periodLabel}</h3>
          </div>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile
              icon={Users}
              tone="navy"
              value={<span className="tabular-nums">{result.totals.totalPatients}</span>}
              label="مراجع"
            />
            <StatTile
              icon={Wallet}
              tone="success"
              value={<span className="tabular-nums">{formatCurrency(result.totals.totalCollected)}</span>}
              label="مدفوع"
            />
            <StatTile
              icon={UserX}
              tone="danger"
              value={<span className="tabular-nums">{result.totals.debtors}</span>}
              label="مديونين"
            />
            <StatTile
              icon={Hourglass}
              tone="warning"
              value={<span className="tabular-nums">{formatCurrency(result.totals.totalRemaining)}</span>}
              label="متبقي"
            />
          </div>
        </div>
      )}

      {loading && (
        <div className="space-y-2.5">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={`k${i}`} className="mc-skeleton h-[76px] rounded-2xl" />
            ))}
          </div>
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="mc-skeleton h-12 rounded-xl" />
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
