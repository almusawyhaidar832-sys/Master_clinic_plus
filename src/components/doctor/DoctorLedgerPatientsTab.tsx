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
import { cn, formatCurrency, formatDate } from "@/lib/utils";
import { RefreshCw } from "lucide-react";

interface DoctorLedgerPatientsTabProps {
  refreshKey?: number;
}

export function DoctorLedgerPatientsTab({
  refreshKey = 0,
}: DoctorLedgerPatientsTabProps) {
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
        setError(json.error ?? "تعذر تحميل المراجعين");
        setAllRows([]);
        setTotal(0);
        return;
      }

      setAllRows(json.rows ?? []);
      setTotal(json.total ?? json.rows?.length ?? 0);
    } catch {
      setError("تعذر الاتصال بالسيرفر");
    } finally {
      setLoading(false);
    }
  }, [dateFrom, dateTo]);

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
      header: "التاريخ",
      render: (row) => formatDate(row.payment_date),
    },
    {
      key: "name",
      header: "المراجع",
      render: (row) => (
        <div className="flex flex-wrap items-center gap-1">
          <span className="font-medium text-slate-text">
            {row.patient_name_ar}
          </span>
          {row.is_first_payment && (
            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800">
              جديد
            </span>
          )}
        </div>
      ),
    },
    {
      key: "procedure",
      header: "الجلسة",
      render: (row) => (
        <span className="text-slate-700">{row.procedure_label}</span>
      ),
    },
    {
      key: "paid",
      header: "المدفوع",
      render: (row) => (
        <span className="font-semibold text-primary tabular-nums">
          {formatCurrency(row.paid_amount)}
        </span>
      ),
    },
    {
      key: "share",
      header: "حصتك",
      render: (row) => (
        <span className="font-bold text-emerald-600 tabular-nums">
          {formatCurrency(row.doctor_share)}
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-muted">
        دفعات المراجعين — اكتب حرفين من الاسم لاقتراح الأسماء
      </p>

      <div ref={searchWrapRef} className="relative">
        <Input
          label="بحث بالاسم"
          name="patient_search"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setSuggestOpen(true);
          }}
          onFocus={() => setSuggestOpen(true)}
          placeholder="اكتب أول حرفين من الاسم..."
          autoComplete="off"
        />
        {suggestOpen && suggestions.length > 0 && (
          <ul
            className="absolute z-20 mt-1 max-h-48 w-full overflow-y-auto rounded-xl border border-slate-border bg-white py-1 shadow-lg"
            role="listbox"
          >
            {suggestions.map((name) => (
              <li key={name}>
                <button
                  type="button"
                  role="option"
                  className="w-full px-3 py-2 text-right text-sm text-slate-text hover:bg-primary/5"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pickSuggestion(name)}
                >
                  {name}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
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
          onChange={(e) => setDateTo(e.target.value)}
          dir="ltr"
          className="text-left"
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-slate-600">
          {search.trim() ? (
            <>
              نتائج البحث: <strong>{rows.length}</strong> من{" "}
              <strong>{total}</strong>
            </>
          ) : (
            <>
              الدفعات: <strong>{total}</strong>
            </>
          )}
        </p>
        <button
          type="button"
          onClick={() => void load()}
          className="flex items-center gap-1 rounded-lg border border-slate-border px-3 py-1.5 text-sm text-slate-muted hover:bg-surface-card"
        >
          <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
          تحديث
        </button>
      </div>

      {error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
          {error}
        </p>
      )}

      {loading ? (
        <div className="flex justify-center py-12">
          <RefreshCw className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : (
        <DataTable
          columns={columns}
          data={rows}
          emptyMessage={
            search.trim()
              ? "لا يوجد مراجع بهذا الاسم — اختر من الاقتراحات أو جرّب جزءاً آخر"
              : "لا توجد دفعات في الفترة المحددة"
          }
        />
      )}
    </div>
  );
}
