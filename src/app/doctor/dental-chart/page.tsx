"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { Alert } from "@/components/ui/Alert";
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
      <div className="space-y-4">
        <div>
          <h2 className="text-lg font-bold text-slate-text">
            {t("docDentalChartTitle")}
          </h2>
          <p className="text-sm text-slate-muted">
            {t("docDentalChartSubtitle")}
          </p>
        </div>

        <OfflineViewBanner
          refreshing={refreshing}
          offline={offlineView}
          cachedAt={cachedAt}
          refreshingLabel={t("offlineViewRefreshing")}
          offlineLabel={t("offlineViewCachedAt")}
        />

        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-slate-text">
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
            inputClassName="h-10"
          />
        </div>

        {patientId && patientName && (
          <p className="text-sm text-slate-text">
            {t("docPatientLabel")} <strong>{patientName}</strong>
          </p>
        )}

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
          <p className="text-sm text-slate-muted">{t("docLoadingChart")}</p>
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
          <p className="rounded-xl border border-dashed border-slate-border p-6 text-center text-sm text-slate-muted">
            {t("docSelectPatientForChart")}
          </p>
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
