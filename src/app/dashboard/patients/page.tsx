"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { createClient } from "@/lib/supabase/client";
import { useActiveClinicId } from "@/hooks/useActiveClinicId";
import { formatCurrency, cn } from "@/lib/utils";
import { computeOutstandingDebtFromOperations } from "@/lib/services/patient-treatment-cases";
import { searchPatientsViaApi } from "@/lib/services/patient-search";
import type { Patient, PatientOperation } from "@/types";
import { Search, FileText, CalendarDays } from "lucide-react";
import { AddPatientForm } from "@/components/patients/AddPatientForm";
import { PatientDailyVisitsPanel } from "@/components/patients/PatientDailyVisitsPanel";
import { getPatientDisplayPhone } from "@/lib/phone";

interface PatientWithStats extends Patient {
  visit_count?: number;
  total_debt?: number;
}

type PageTab = "visits" | "search";

export default function PatientsSearchPage() {
  const { clinicId } = useActiveClinicId();
  const [activeTab, setActiveTab] = useState<PageTab>("visits");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PatientWithStats[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const search = useCallback(async (q: string) => {
    const trimmed = q.trim();
    if (trimmed.length < 2) {
      setResults([]);
      setSearched(false);
      setSearchError(null);
      return;
    }

    setLoading(true);
    setSearched(true);
    setSearchError(null);

    const { patients, error } = await searchPatientsViaApi(trimmed, {
      portal: "accountant",
      limit: 30,
      minLength: 2,
    });

    if (error) {
      setResults([]);
      setSearchError(error);
      setLoading(false);
      return;
    }

    const ids = patients.map((p) => p.id);
    const debtMap: Record<string, number> = {};

    if (ids.length > 0) {
      const supabase = createClient();
      let opQuery = supabase
        .from("patient_operations")
        .select(
          "id, patient_id, total_amount, paid_amount, remaining_debt, operation_name_ar, operation_type, treatment_case_id, created_at, operation_date"
        )
        .in("patient_id", ids)
        .order("created_at", { ascending: true });
      if (clinicId) opQuery = opQuery.eq("clinic_id", clinicId);
      const { data: opData, error: opErr } = await opQuery;

      if (!opErr && opData) {
        const byPatient = new Map<string, PatientOperation[]>();
        for (const op of opData as PatientOperation[]) {
          const list = byPatient.get(op.patient_id) ?? [];
          list.push(op);
          byPatient.set(op.patient_id, list);
        }
        for (const pid of ids) {
          const ops = byPatient.get(pid) ?? [];
          debtMap[pid] = computeOutstandingDebtFromOperations(ops, pid);
        }
      }
    }

    setResults(
      patients.map((p) => ({
        ...p,
        total_debt: debtMap[p.id] ?? 0,
      })) as PatientWithStats[]
    );
    setLoading(false);
  }, [clinicId]);

  useEffect(() => {
    if (activeTab !== "search") return;
    const t = setTimeout(() => search(query), 280);
    return () => clearTimeout(t);
  }, [query, search, activeTab]);

  useEffect(() => {
    if (activeTab === "search") {
      inputRef.current?.focus();
    }
  }, [activeTab]);

  return (
    <div
      className={cn(
        "mx-auto space-y-6",
        activeTab === "visits" ? "max-w-6xl" : "max-w-2xl"
      )}
    >
      <div>
        <h2 className="text-2xl font-bold text-slate-text">ملفات المرضى</h2>
        <p className="text-slate-muted">
          {activeTab === "visits"
            ? "كل من دخل العيادة — الاسم، الهاتف، الطبيب، والمدفوعات"
            : "ابحث بالاسم لفتح ملف مراجع محدد"}
        </p>
      </div>

      <div className="mc-tab-group">
        <button
          type="button"
          onClick={() => setActiveTab("visits")}
          className={cn("mc-tab", activeTab === "visits" && "mc-tab--active")}
        >
          <CalendarDays className="h-4 w-4" />
          زيارات اليوم
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("search")}
          className={cn("mc-tab", activeTab === "search" && "mc-tab--active")}
        >
          <Search className="h-4 w-4" />
          بحث عن مريض
        </button>
      </div>

      {activeTab === "visits" ? (
        <PatientDailyVisitsPanel />
      ) : (
        <>
          <div className="relative">
            <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-muted" />
            <input
              ref={inputRef}
              type="text"
              className="w-full rounded-xl border border-slate-border bg-surface-card py-3 pr-10 pl-4 text-sm text-slate-text shadow-card outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="اكتب اسم المريض للبحث..."
              autoComplete="off"
            />
          </div>

          {loading && (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="h-16 animate-pulse rounded-xl bg-slate-100"
                />
              ))}
            </div>
          )}

          {searchError && (
            <Alert variant="error">تعذر البحث: {searchError}</Alert>
          )}

          {!loading && searched && results.length === 0 && !searchError && (
            <Alert variant="info">
              لا يوجد مراجع بهذا الاسم في عيادتك. يمكنك إضافته من النموذج أدناه.
            </Alert>
          )}

          {!loading && results.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-primary">
                {results.length} نتيجة
              </p>
              {results.map((p) => (
                <Link key={p.id} href={`/dashboard/patients/${p.id}`}>
                  <Card className="mc-hover-lift flex cursor-pointer items-center justify-between gap-4 py-4 active:scale-[0.99]">
                    <div className="flex items-center gap-3">
                      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary to-primary-700 text-sm font-bold text-white shadow-sm">
                        {p.full_name_ar.slice(0, 2)}
                      </div>
                      <div>
                        <p className="font-semibold text-slate-text">
                          {p.full_name_ar}
                        </p>
                        {getPatientDisplayPhone(p) && (
                          <p className="text-xs text-slate-muted" dir="ltr">
                            {getPatientDisplayPhone(p)}
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-3 text-left">
                      {(p.total_debt ?? 0) > 0 && (
                        <span className="rounded-full bg-orange-100 px-2.5 py-1 text-xs font-bold text-orange-900 ring-1 ring-orange-300">
                          مديون · {formatCurrency(p.total_debt ?? 0)}
                        </span>
                      )}
                      <FileText className="h-4 w-4 text-slate-muted" />
                    </div>
                  </Card>
                </Link>
              ))}
            </div>
          )}

          {!searched && query.trim().length < 2 && (
            <p className="py-4 text-center text-sm text-slate-muted">
              ابدأ بكتابة حرفين على الأقل من اسم المراجع
            </p>
          )}

          <AddPatientForm />

          <Link href="/dashboard/ledger">
            <Button variant="outline" size="sm">
              تسجيل جلسة (الإدخال السريع)
            </Button>
          </Link>
        </>
      )}
    </div>
  );
}
