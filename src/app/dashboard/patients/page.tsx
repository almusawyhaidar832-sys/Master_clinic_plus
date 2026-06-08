"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { createClient } from "@/lib/supabase/client";
import { useActiveClinicId } from "@/hooks/useActiveClinicId";
import { formatCurrency } from "@/lib/utils";
import { computeOutstandingDebtFromOperations } from "@/lib/services/patient-treatment-cases";
import { searchPatientsByQuery } from "@/lib/services/patient-search";
import type { Patient, PatientOperation } from "@/types";
import { Search, FileText } from "lucide-react";
import { AddPatientForm } from "@/components/patients/AddPatientForm";
import { WhatsAppTestButton } from "@/components/patients/WhatsAppTestButton";
import { getPatientDisplayPhone } from "@/lib/phone";

interface PatientWithStats extends Patient {
  visit_count?: number;
  total_debt?: number;
}

export default function PatientsSearchPage() {
  const { clinicId } = useActiveClinicId();
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

    const supabase = createClient();
    const { patients, error } = await searchPatientsByQuery(supabase, trimmed, {
      limit: 30,
      minLength: 2,
      clinicId: clinicId ?? undefined,
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
    const t = setTimeout(() => search(query), 280);
    return () => clearTimeout(t);
  }, [query, search]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-slate-text">ملفات المرضى</h2>
        <p className="text-slate-muted">
          اكتب حرفين من الاسم — تظهر النتائج فوراً
        </p>
      </div>

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
            <div key={i} className="h-16 animate-pulse rounded-xl bg-slate-100" />
          ))}
        </div>
      )}

      {searchError && (
        <Alert variant="error">
          تعذر البحث: {searchError}
        </Alert>
      )}

      {!loading && searched && results.length === 0 && !searchError && (
        <Alert variant="info">
          لا يوجد مراجع بهذا الاسم في عيادتك. يمكنك إضافته من النموذج أدناه.
        </Alert>
      )}

      {!loading && results.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-primary">
            {results.length} نتيجة
          </p>
          {results.map((p) => (
            <Link key={p.id} href={`/dashboard/patients/${p.id}`}>
              <Card className="flex cursor-pointer items-center justify-between gap-4 transition-shadow hover:shadow-premium active:scale-[0.99]">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary font-bold text-sm">
                    {p.full_name_ar.slice(0, 2)}
                  </div>
                  <div>
                    <p className="font-semibold text-slate-text">{p.full_name_ar}</p>
                    {getPatientDisplayPhone(p) && (
                      <p className="text-xs text-slate-muted" dir="ltr">
                        {getPatientDisplayPhone(p)}
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-3 text-left">
                  {(p.total_debt ?? 0) > 0 && (
                    <span className="rounded-full bg-debt/40 px-2 py-0.5 text-xs font-semibold text-debt-text">
                      ذمة: {formatCurrency(p.total_debt ?? 0)}
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
        <p className="text-center text-sm text-slate-muted py-4">
          ابدأ بكتابة حرفين على الأقل من اسم المراجع
        </p>
      )}

      <AddPatientForm />

      <WhatsAppTestButton />

      <Link href="/dashboard/ledger">
        <Button variant="outline" size="sm">
          تسجيل جلسة (الإدخال السريع)
        </Button>
      </Link>
    </div>
  );
}
