"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { Alert } from "@/components/ui/Alert";
import { PageHeader } from "@/components/ui/PageHeader";
import { Smile } from "lucide-react";
import { PatientSearchField } from "@/components/patients/PatientSearchField";
import { InteractiveDentalChart } from "@/components/clinical/InteractiveDentalChart.lazy";
import { ModuleGuard } from "@/components/layout/ModuleGuard";
import { useLanguage } from "@/contexts/LanguageContext";
import {
  chartMapFromRows,
  type PatientToothChartMap,
  type PatientToothState,
} from "@/lib/clinical/tooth-status";
import { createClient } from "@/lib/supabase/client";
import { isBrowserOffline } from "@/lib/offline/network";
import {
  readPatientToothChartCache,
  writePatientToothChartCache,
} from "@/lib/offline/patient-profile-cache";
import { OfflineViewBanner } from "@/components/offline/OfflineViewBanner";
import { getDoctorForCurrentUser } from "@/lib/clinic-context";
import {
  fetchPatientToothChart,
  savePatientToothChart,
} from "@/lib/services/patient-tooth-chart";

function DentalChartContent() {
  const searchParams = useSearchParams();
  const preselectedId = searchParams.get("patientId");
  const { t, bi } = useLanguage();

  const [patientQuery, setPatientQuery] = useState("");
  const [patientId, setPatientId] = useState(preselectedId ?? "");
  const [patientName, setPatientName] = useState("");
  const [chart, setChart] = useState<PatientToothChartMap>({});
  const [loading, setLoading] = useState(false);
  const [savingTooth, setSavingTooth] = useState<number | null>(null);
  const [message, setMessage] = useState<{
    type: "success" | "error" | "info";
    text: string;
  } | null>(null);
  const [offlineView, setOfflineView] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [cachedAt, setCachedAt] = useState<number | null>(null);
  const [clinicId, setClinicId] = useState<string | null>(null);

  const loadChart = useCallback(async (id: string, clinic: string | null) => {
    setMessage(null);
    const cached = clinic ? readPatientToothChartCache(clinic, id) : null;
    if (cached) {
      setChart(chartMapFromRows(cached.teeth));
      setCachedAt(cached.cachedAt);
      if (isBrowserOffline()) {
        setOfflineView(true);
        setRefreshing(false);
        setLoading(false);
        return;
      }
      setOfflineView(false);
      setRefreshing(true);
    } else {
      setLoading(true);
    }

    const { teeth, tablesMissing, error } = await fetchPatientToothChart(id);
    setLoading(false);
    setRefreshing(false);

    if (tablesMissing) {
      setMessage({
        type: "info",
        text: t("docDentalChartMissing"),
      });
      if (!cached) setChart({});
      return;
    }

    if (error) {
      if (cached) {
        setOfflineView(true);
        return;
      }
      setMessage({ type: "error", text: error });
      return;
    }

    setChart(chartMapFromRows(teeth));
    setOfflineView(false);
    setCachedAt(Date.now());
    if (clinic) {
      writePatientToothChartCache(clinic, id, teeth);
    }
  }, [t]);

  useEffect(() => {
    async function loadDoctor() {
      const supabase = createClient();
      const doctor = await getDoctorForCurrentUser(supabase);
      setClinicId(doctor?.clinic_id ?? null);
    }
    void loadDoctor();
  }, []);

  useEffect(() => {
    if (!preselectedId) return;
    async function loadPreselected() {
      const supabase = createClient();
      const { data } = await supabase
        .from("patients")
        .select("id, full_name_ar")
        .eq("id", preselectedId)
        .maybeSingle();
      if (data) {
        setPatientId(data.id);
        setPatientQuery(String(data.full_name_ar ?? ""));
        setPatientName(String(data.full_name_ar ?? ""));
      }
    }
    void loadPreselected();
  }, [preselectedId]);

  useEffect(() => {
    if (!patientId) {
      setChart({});
      return;
    }
    void loadChart(patientId, clinicId);
  }, [patientId, clinicId, loadChart]);

  async function persistTooth(update: PatientToothState) {
    if (!patientId) return;
    if (isBrowserOffline()) {
      setMessage({
        type: "error",
        text: t("offlineWriteRequiresNetwork"),
      });
      return;
    }
    setSavingTooth(update.tooth_number);
    setMessage(null);

    const result = await savePatientToothChart({
      patient_id: patientId,
      teeth: [update],
    });

    setSavingTooth(null);

    if (!result.ok) {
      setMessage({ type: "error", text: result.error });
      return;
    }

    setChart((prev) => ({
      ...prev,
      [update.tooth_number]: update,
    }));
    if (clinicId) {
      const teeth = Object.values({
        ...chart,
        [update.tooth_number]: update,
      });
      writePatientToothChartCache(clinicId, patientId, teeth);
    }
    setMessage({
      type: "success",
      text: bi(
        `تم حفظ السن ${update.tooth_number}`,
        `Tooth ${update.tooth_number} saved`
      ),
    });
  }

  async function resetTooth(toothNumber: number) {
    if (!patientId) return;
    if (isBrowserOffline()) {
      setMessage({
        type: "error",
        text: t("offlineWriteRequiresNetwork"),
      });
      return;
    }
    setSavingTooth(toothNumber);
    setMessage(null);

    const result = await savePatientToothChart({
      patient_id: patientId,
      teeth: [
        {
          tooth_number: toothNumber,
          status: "healthy",
          procedure_ar: null,
          note: null,
        },
      ],
    });

    setSavingTooth(null);

    if (!result.ok) {
      setMessage({ type: "error", text: result.error });
      return;
    }

    setChart((prev) => {
      const next = { ...prev };
      delete next[toothNumber];
      return next;
    });
    if (clinicId) {
      const teeth = Object.values(chart).filter(
        (row) => row.tooth_number !== toothNumber
      );
      writePatientToothChartCache(clinicId, patientId, teeth);
    }
    setMessage({
      type: "success",
      text: bi(
        `تمت إعادة السن ${toothNumber} إلى سليم`,
        `Tooth ${toothNumber} reset to healthy`
      ),
    });
  }

  return (
    <ModuleGuard module="dental_chart">
      <div className="space-y-5">
        <PageHeader
          title={t("docDentalChartTitle")}
          subtitle={t("docDentalChartSubtitle")}
          eyebrow={bi("بوابة الطبيب", "Doctor portal")}
          icon={Smile}
        />

        <OfflineViewBanner
          refreshing={refreshing}
          offline={offlineView}
          cachedAt={cachedAt}
          refreshingLabel={t("offlineViewRefreshing")}
          offlineLabel={t("offlineViewCachedAt")}
        />

        <section className="mc-panel">
        <div className="mc-panel-body space-y-3">
        <div className="space-y-1.5">
          <label className="mc-label block">
            {t("docSelectPatient")}
          </label>
          <PatientSearchField
            value={patientQuery}
            onChange={(value) => {
              setPatientQuery(value);
              setPatientId("");
              setPatientName("");
              setChart({});
              setMessage(null);
            }}
            onSelect={(p) => {
              setPatientId(p.id);
              setPatientQuery(p.full_name_ar);
              setPatientName(p.full_name_ar);
            }}
            portal="doctor"
            clinicId={clinicId}
            selectedPatientId={patientId || null}
            placeholder={t("docStatementSearchPlaceholder")}
            inputClassName="h-11"
          />
        </div>

        {patientId && patientName && (
          <div className="flex items-center gap-3 rounded-xl border border-slate-border bg-surface px-3 py-2.5">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-mc-pearl text-xs font-bold text-[#0b1f3a] ring-1 ring-inset ring-premium-300/60">
              {patientName.slice(0, 2)}
            </span>
            <p className="min-w-0 truncate text-sm text-slate-text">
              {t("docPatientLabel")} <strong>{patientName}</strong>
            </p>
          </div>
        )}
        </div>
        </section>

        {message && (
          <Alert
            variant={
              message.type === "error"
                ? "error"
                : message.type === "success"
                  ? "success"
                  : "info"
            }
          >
            {message.text}
          </Alert>
        )}

        {loading && !Object.keys(chart).length && (
          <div className="space-y-2">
            <div className="mc-skeleton h-64 rounded-2xl" />
            <p className="text-center text-sm text-slate-muted">{t("docLoadingChart")}</p>
          </div>
        )}

        {patientId && (!loading || cachedAt != null) && (
          <InteractiveDentalChart
            mode="patient"
            value={chart}
            onToothUpdate={persistTooth}
            onToothReset={resetTooth}
            savingTooth={savingTooth}
          />
        )}

        {!patientId && (
          <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-slate-border bg-surface-card px-6 py-12 text-center">
            <span className="mc-icon-tile h-12 w-12 rounded-2xl">
              <Smile className="h-6 w-6" />
            </span>
            <p className="max-w-xs text-sm text-slate-muted">
              {t("docSelectPatientForChart")}
            </p>
          </div>
        )}
      </div>
    </ModuleGuard>
  );
}

export default function DoctorDentalChartPage() {
  const { t } = useLanguage();

  return (
    <Suspense fallback={<p className="text-slate-muted">{t("loading")}</p>}>
      <DentalChartContent />
    </Suspense>
  );
}
