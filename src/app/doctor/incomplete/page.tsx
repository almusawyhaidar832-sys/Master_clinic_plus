"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { getDoctorForCurrentUser } from "@/lib/clinic-context";
import { fetchOpenTreatmentCasesForDoctor } from "@/lib/services/patient-treatment-cases";
import { useLanguage } from "@/contexts/LanguageContext";
import { AlertCircle, CheckCircle2, ChevronLeft, Stethoscope } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";

export default function IncompleteTreatmentsPage() {
  const { t, bi, formatMoney } = useLanguage();
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
    <div className="space-y-5">
      <PageHeader
        title={t("docIncompleteTitle")}
        subtitle={t("docIncompleteSubtitle")}
        eyebrow={bi("بوابة الطبيب", "Doctor portal")}
        icon={AlertCircle}
      />

      {loading ? (
        <div className="space-y-2.5" aria-label={t("loading")}>
          {[1, 2, 3].map((i) => (
            <div key={i} className="mc-skeleton h-[84px] rounded-2xl" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          icon={CheckCircle2}
          message={t("docNoActiveTreatments")}
          className="rounded-2xl"
        />
      ) : (
        <div className="space-y-2.5 animate-fade-in">
          {items.map((item) => (
            <Link
              key={item.id}
              href={
                item.patient_id
                  ? `/doctor/patients/${item.patient_id}`
                  : "/doctor/patients"
              }
              className="group mc-list-row mc-press items-start"
            >
              <span className="mc-kpi__icon mc-tone-warning h-11 w-11">
                <Stethoscope className="h-5 w-5" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-bold text-slate-text">
                  {item.patient_name ?? t("entityPatient")}
                </p>
                <p className="mt-0.5 truncate text-sm text-slate-muted">
                  {item.treatment_name_ar}
                </p>
                <span className="mt-2 inline-flex rounded-full border border-debt-border bg-debt px-2.5 py-0.5 text-xs font-bold text-debt-text tabular-nums">
                  {t("docRemaining")} {formatMoney(item.remaining_balance)}
                </span>
              </div>
              <ChevronLeft className="mt-3 h-5 w-5 shrink-0 text-slate-muted transition-colors group-hover:text-premium-500 ltr:rotate-180" />
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
