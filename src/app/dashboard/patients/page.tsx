"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { createClient } from "@/lib/supabase/client";
import { formatCurrency } from "@/lib/utils";
import { computeOutstandingDebtFromOperations } from "@/lib/services/patient-treatment-cases";
import type { Patient, PatientOperation } from "@/types";
import { Search, UserPlus, FileText } from "lucide-react";

interface PatientWithStats extends Patient {
  visit_count?: number;
  total_debt?: number;
}

export default function PatientsSearchPage() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PatientWithStats[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const search = useCallback(async (q: string) => {
    if (!q.trim()) {
      setResults([]);
      setSearched(false);
      return;
    }
    setLoading(true);
    setSearched(true);
    const supabase = createClient();
    const { data } = await supabase
      .from("patients")
      .select("*")
      .ilike("full_name_ar", `%${q.trim()}%`)
      .order("full_name_ar")
      .limit(30);

    const patients = (data as Patient[]) || [];

    // Load debt summary per patient
    const ids = patients.map((p) => p.id);
    const debtMap: Record<string, number> = {};
    if (ids.length > 0) {
      const { data: opData } = await supabase
        .from("patient_operations")
        .select("*")
        .in("patient_id", ids)
        .order("created_at", { ascending: true });
      const byPatient = new Map<string, PatientOperation[]>();
      for (const op of (opData as PatientOperation[]) || []) {
        const list = byPatient.get(op.patient_id) ?? [];
        list.push(op);
        byPatient.set(op.patient_id, list);
      }
      for (const pid of ids) {
        const ops = byPatient.get(pid) ?? [];
        debtMap[pid] = computeOutstandingDebtFromOperations(ops, pid);
      }
    }

    setResults(
      patients.map((p) => ({
        ...p,
        total_debt: debtMap[p.id] ?? 0,
      }))
    );
    setLoading(false);
  }, []);

  // Debounced search
  useEffect(() => {
    const t = setTimeout(() => search(query), 350);
    return () => clearTimeout(t);
  }, [query, search]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-slate-text">ملفات المرضى</h2>
        <p className="text-slate-muted">ابحث عن مريض لعرض ملفه أو إضافة جلسة جديدة</p>
      </div>

      {/* Search box */}
      <div className="relative">
        <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-muted" />
        <input
          ref={inputRef}
          type="text"
          className="w-full rounded-xl border border-slate-border bg-surface-card py-3 pr-10 pl-4 text-sm text-slate-text shadow-card outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="اكتب اسم المريض للبحث..."
        />
      </div>

      {/* Quick add via ledger */}
      <Link href="/dashboard/ledger">
        <Button variant="outline" size="sm">
          <UserPlus className="h-4 w-4" />
          تسجيل مريض جديد (من صفحة الإدخال السريع)
        </Button>
      </Link>

      {/* Results */}
      {loading && (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-16 animate-pulse rounded-xl bg-slate-100" />
          ))}
        </div>
      )}

      {!loading && searched && results.length === 0 && (
        <Alert variant="info">
          لا يوجد مريض بهذا الاسم. سيُنشأ تلقائياً عند أول تسجيل جلسة.
        </Alert>
      )}

      {!loading && results.length > 0 && (
        <div className="space-y-2">
          {results.map((p) => (
            <Link key={p.id} href={`/dashboard/patients/${p.id}`}>
              <Card className="flex cursor-pointer items-center justify-between gap-4 transition-shadow hover:shadow-premium active:scale-[0.99]">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary font-bold text-sm">
                    {p.full_name_ar.slice(0, 2)}
                  </div>
                  <div>
                    <p className="font-semibold text-slate-text">{p.full_name_ar}</p>
                    {p.phone && (
                      <p className="text-xs text-slate-muted" dir="ltr">
                        {p.phone}
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

      {!searched && (
        <p className="text-center text-sm text-slate-muted py-8">
          ابدأ بكتابة الاسم للبحث في قاعدة البيانات
        </p>
      )}
    </div>
  );
}
