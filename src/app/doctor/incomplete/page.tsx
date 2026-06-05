"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { fetchOpenTreatmentCasesForDoctor } from "@/lib/services/patient-treatment-cases";
import { formatCurrency } from "@/lib/utils";
import { AlertCircle } from "lucide-react";

export default function IncompleteTreatmentsPage() {
  const [items, setItems] = useState<
    Awaited<ReturnType<typeof fetchOpenTreatmentCasesForDoctor>>
  >([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const open = await fetchOpenTreatmentCasesForDoctor(supabase);
      setItems(open);
      setLoading(false);
    }
    load();
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <AlertCircle className="h-5 w-5 text-amber-600" />
        <h2 className="text-lg font-bold text-slate-text">علاجات غير مكتملة</h2>
      </div>
      <p className="text-sm text-slate-muted">
        حالات عليها ذمة متبقية — اضغط لمتابعة الجلسات
      </p>

      {loading ? (
        <p className="text-sm text-slate-muted">جاري التحميل...</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-slate-muted">لا توجد علاجات نشطة حالياً</p>
      ) : (
        items.map((t) => (
          <Link
            key={t.id}
            href={
              t.patient_id
                ? `/doctor/patients/${t.patient_id}`
                : "/doctor/patients"
            }
            className="block rounded-xl border border-amber-200 bg-amber-50/50 p-4 transition hover:border-primary"
          >
            <p className="font-semibold text-slate-text">
              {t.patient_name ?? "مراجع"}
            </p>
            <p className="text-sm text-slate-muted">{t.treatment_name_ar}</p>
            <p className="mt-1 text-sm font-bold text-debt-text tabular-nums">
              متبقي {formatCurrency(t.remaining_balance)}
            </p>
          </Link>
        ))
      )}
    </div>
  );
}
