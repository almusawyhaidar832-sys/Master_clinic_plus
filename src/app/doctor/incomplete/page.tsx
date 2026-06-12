"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { getDoctorForCurrentUser } from "@/lib/clinic-context";
import { fetchOpenTreatmentCasesForDoctor } from "@/lib/services/patient-treatment-cases";
import { useLanguage } from "@/contexts/LanguageContext";
import { AlertCircle } from "lucide-react";

export default function IncompleteTreatmentsPage() {
  const { t, formatMoney } = useLanguage();
  const [items, setItems] = useState<
    Awaited<ReturnType<typeof fetchOpenTreatmentCasesForDoctor>>
  >([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const doctor = await getDoctorForCurrentUser(supabase);
      if (!doctor) {
        setItems([]);
        setLoading(false);
        return;
      }
      const open = await fetchOpenTreatmentCasesForDoctor(supabase, doctor.id);
      setItems(open);
      setLoading(false);
    }
    load();
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <AlertCircle className="h-5 w-5 text-amber-600" />
        <h2 className="text-lg font-bold text-slate-text">{t("docIncompleteTitle")}</h2>
      </div>
      <p className="text-sm text-slate-muted">{t("docIncompleteSubtitle")}</p>

      {loading ? (
        <p className="text-sm text-slate-muted">{t("loading")}</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-slate-muted">{t("docNoActiveTreatments")}</p>
      ) : (
        items.map((item) => (
          <Link
            key={item.id}
            href={
              item.patient_id
                ? `/doctor/patients/${item.patient_id}`
                : "/doctor/patients"
            }
            className="block rounded-xl border border-amber-200 bg-amber-50/50 p-4 transition hover:border-primary"
          >
            <p className="font-semibold text-slate-text">
              {item.patient_name ?? t("entityPatient")}
            </p>
            <p className="text-sm text-slate-muted">{item.treatment_name_ar}</p>
            <p className="mt-1 text-sm font-bold text-debt-text tabular-nums">
              {t("docRemaining")} {formatMoney(item.remaining_balance)}
            </p>
          </Link>
        ))
      )}
    </div>
  );
}
