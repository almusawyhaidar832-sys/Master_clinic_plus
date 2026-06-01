"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { AlertCircle } from "lucide-react";

interface Treatment {
  id: string;
  title_ar: string;
  patient?: { full_name_ar: string };
}

export default function IncompleteTreatmentsPage() {
  const [items, setItems] = useState<Treatment[]>([]);

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const { data } = await supabase
        .from("treatments")
        .select("id, title_ar, patient:patients!patient_id(full_name_ar)")
        .eq("status", "active");
      const rows = (data ?? []).map((row) => {
        const patient = row.patient as
          | { full_name_ar: string }
          | { full_name_ar: string }[]
          | null;
        return {
          id: row.id as string,
          title_ar: row.title_ar as string,
          patient: Array.isArray(patient) ? patient[0] : patient ?? undefined,
        };
      });
      setItems(rows);
    }
    load();
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <AlertCircle className="h-5 w-5 text-amber-600" />
        <h2 className="text-lg font-bold text-slate-text">علاجات غير مكتملة</h2>
      </div>
      {items.length === 0 ? (
        <p className="text-sm text-slate-muted">لا توجد علاجات نشطة حالياً</p>
      ) : (
        items.map((t) => (
          <div
            key={t.id}
            className="rounded-xl border border-amber-200 bg-amber-50/50 p-4"
          >
            <p className="font-semibold">{t.patient?.full_name_ar}</p>
            <p className="text-sm text-slate-muted">{t.title_ar}</p>
          </div>
        ))
      )}
    </div>
  );
}
