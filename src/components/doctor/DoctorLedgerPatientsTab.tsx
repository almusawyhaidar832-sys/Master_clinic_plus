"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Input } from "@/components/ui/Input";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { authPortalHeaders } from "@/lib/auth/api-portal";
import {
  matchesPatientRowSearch,
  suggestPatientNames,
  type DoctorLedgerPatientRow,
} from "@/lib/services/doctor-financial-ledger";
import { useLanguage } from "@/contexts/LanguageContext";
import { cn, formatDate } from "@/lib/utils";
import { AlertCircle, RefreshCw, Search, UserRound, Users } from "lucide-react";

interface DoctorLedgerPatientsTabProps {
  refreshKey?: number;
}

export function DoctorLedgerPatientsTab({
  refreshKey = 0,
}: DoctorLedgerPatientsTabProps) {
  const { t, formatMoney, dateLocale } = useLanguage();
  const [search, setSearch] = useState("");
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [allRows, setAllRows] = useState<DoctorLedgerPatientRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const searchWrapRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");

    const params = new URLSearchParams({
      section: "patients",
      limit: "300",
    });
    if (dateFrom) params.set("date_from", dateFrom);
    if (dateTo) params.set("date_to", dateTo);

    try {
      const res = await fetch(`/api/doctor/financial-ledger?${params}`, {
        credentials: "include",
        headers: authPortalHeaders("doctor"),
      });
      const json = (await res.json()) as {
        rows?: DoctorLedgerPatientRow[];
        total?: number;
        error?: string;
      };

      if (!res.ok) {
        setError(json.error ?? t("docLoadPatientsFailed"));
        setAllRows([]);
        setTotal(0);
        return;
      }

      setAllRows(json.rows ?? []);
      setTotal(json.total ?? json.rows?.length ?? 0);
    } catch {
      setError(t("errServerConnection"));
    } finally {
      setLoading(false);
    }
  }, [dateFrom, dateTo, t]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!searchWrapRef.current?.contains(e.target as Node)) {
        setSuggestOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const suggestions = useMemo(
    () => suggestPatientNames(allRows, search),
    [allRows, search]
  );

  const rows = useMemo(() => {
    const q = search.trim();
    if (!q) return allRows;
    return allRows.filter((r) => matchesPatientRowSearch(r, q));
  }, [allRows, search]);

  const pickSuggestion = (name: string) => {
    setSearch(name);
    setSuggestOpen(false);
  };

  const columns: Column<DoctorLedgerPatientRow>[] = [
    {
      key: "date",
      header: t("docColDate"),
      render: (row) => formatDate(row.payment_date, dateLocale),
    },
    {
      key: "name",
      header: t("docColPatient"),
      render: (row) => (
        <div className="flex flex-wrap items-center gap-1">
          <span className="font-medium text-slate-text">
            {row.patient_name_ar}
          </span>
          {row.is_first_payment && (
            <span className="mc-tone-success rounded-full px-2 py-0.5 text-[10px] font-bold ring-1 ring-inset">
              {t("docNewPatientBadge")}
            </span>
          )}
        </div>
      ),
    },
    {
      key: "procedure",
      header: t("docColSession"),
      render: (row) => (
        <span className="text-slate-text">{row.procedure_label}</span>
      ),
    },
    {
      key: "lab",
      header: t("docColLabCost"),
      render: (row) =>
        row.materials_cost > 0 ? (
          <span
            className="tabular-nums text-warning-text"
            title={row.lab_notes ?? undefined}
          >
            {formatMoney(row.materials_cost)}
          </span>
        ) : (
          <span className="text-slate-muted">—</span>
        ),
    },
    {
      key: "paid",
      header: t("docColPaid"),
      render: (row) => (
        <span className="font-semibold text-primary tabular-nums">
          {formatMoney(row.paid_amount)}
        </span>
      ),
    },
    {
      key: "share",
      header: t("docColYourShare"),
      render: (row) => (
        <span className="font-bold text-success-text tabular-nums">
          {formatMoney(row.doctor_share)}
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <p className="px-1 text-xs leading-relaxed text-slate-muted">{t("docLedgerPatientsIntro")}</p>

      <section className="mc-panel !overflow-visible">
        <div className="space-y-3 p-4">
          <div ref={searchWrapRef} className="relative">
            <Input
              label={t("docSearchByName")}
              name="patient_search"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setSuggestOpen(true);
              }}
              onFocus={() => setSuggestOpen(true)}
              placeholder={t("docSearchNameHint")}
              autoComplete="off"
              className="h-11 rounded-xl ps-10"
            />
            <Search className="pointer-events-none absolute bottom-3.5 start-3.5 h-4 w-4 text-slate-muted" />
            {suggestOpen && suggestions.length > 0 && (
              <ul
                className="absolute z-20 mt-1.5 max-h-56 w-full overflow-y-auto rounded-2xl border border-slate-border bg-surface-card p-1 shadow-elevated"
                role="listbox"
              >
                {suggestions.map((name) => (
                  <li key={name}>
                    <button
                      type="button"
                      role="option"
                      className="flex min-h-[44px] w-full items-center gap-2.5 rounded-xl px-3 py-2 text-start text-sm text-slate-text hover:bg-surface"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => pickSuggestion(name)}
                    >
                      <UserRound className="h-4 w-4 shrink-0 text-premium-500" />
                      {name}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            <Input
              label={t("docFromDate")}
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              dir="ltr"
              className="h-11 rounded-xl text-left"
            />
            <Input
              label={t("docToDate")}
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              dir="ltr"
              className="h-11 rounded-xl text-left"
            />
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 rounded-b-2xl border-t border-slate-border bg-surface px-4 py-2.5">
          <p className="text-xs text-slate-muted">
            {search.trim() ? (
              <>
                {t("docSearchResultsCount")}{" "}
                <strong className="text-sm font-black tabular-nums text-slate-text">{rows.length}</strong>{" "}
                {t("docFromTotal")}{" "}
                <strong className="font-bold tabular-nums text-slate-text">{total}</strong>
              </>
            ) : (
              <>
                {t("docPaymentsCount")}{" "}
                <strong className="text-sm font-black tabular-nums text-slate-text">{total}</strong>
              </>
            )}
          </p>
          <button
            type="button"
            onClick={() => void load()}
            className="mc-btn-soft min-h-[40px] px-3"
          >
            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
            {t("refresh")}
          </button>
        </div>
      </section>

      {error && (
        <p className="flex items-center gap-2 rounded-2xl border border-debt-border bg-debt px-4 py-3 text-sm text-debt-text">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {error}
        </p>
      )}

      {loading ? (
        <div className="space-y-2.5">
          {[1, 2, 3].map((i) => (
            <div key={i} className="mc-skeleton h-[72px] rounded-2xl" />
          ))}
        </div>
      ) : (
        <>
          <div className="space-y-2.5 sm:hidden">
            {rows.length === 0 ? (
              <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-slate-border bg-surface-card px-4 py-10 text-center">
                <span className="mc-kpi__icon mc-tone-muted h-11 w-11">
                  <Users className="h-5 w-5" />
                </span>
                <p className="text-sm text-slate-muted">
                  {search.trim() ? t("docNoPatientByName") : t("docNoPatientsInPeriod")}
                </p>
              </div>
            ) : (
              rows.map((row) => (
                <div key={row.id} className="mc-list-row !items-start gap-3 !p-3.5">
                  <span className="mc-icon-tile h-10 w-10">
                    <UserRound className="h-[18px] w-[18px]" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <p className="truncate text-sm font-bold text-slate-text">
                        {row.patient_name_ar}
                      </p>
                      {row.is_first_payment && (
                        <span className="mc-tone-success inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold ring-1 ring-inset">
                          {t("docNewPatientBadge")}
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 text-xs text-slate-muted">{row.procedure_label}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-slate-muted">
                      <span>{formatDate(row.payment_date, dateLocale)}</span>
                      {row.materials_cost > 0 && (
                        <span title={row.lab_notes ?? undefined}>
                          {t("docColLabCost")}:{" "}
                          <span className="font-semibold tabular-nums text-warning-text">
                            {formatMoney(row.materials_cost)}
                          </span>
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="shrink-0 text-end">
                    <p className="text-[10px] text-slate-muted">{t("docColYourShare")}</p>
                    <p className="text-sm font-black tabular-nums text-success-text">
                      {formatMoney(row.doctor_share)}
                    </p>
                    <p className="mt-1 text-[10px] text-slate-muted">{t("docColPaid")}</p>
                    <p className="text-xs font-semibold tabular-nums text-slate-text">
                      {formatMoney(row.paid_amount)}
                    </p>
                  </div>
                </div>
              ))
            )}
          </div>
          <div className="hidden sm:block">
            <DataTable
              columns={columns}
              data={rows}
              emptyMessage={
                search.trim() ? t("docNoPatientByName") : t("docNoPatientsInPeriod")
              }
            />
          </div>
        </>
      )}
    </div>
  );
}
