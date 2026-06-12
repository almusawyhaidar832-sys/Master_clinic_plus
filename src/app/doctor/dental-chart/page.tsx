"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { Alert } from "@/components/ui/Alert";
import { PatientSearchField } from "@/components/patients/PatientSearchField";
import { InteractiveDentalChart } from "@/components/clinical/InteractiveDentalChart";
import { ModuleGuard } from "@/components/layout/ModuleGuard";
import { useLanguage } from "@/contexts/LanguageContext";
import {
  chartMapFromRows,
  type PatientToothChartMap,
  type PatientToothState,
} from "@/lib/clinical/tooth-status";
import { createClient } from "@/lib/supabase/client";
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

  const loadChart = useCallback(async (id: string) => {
    setLoading(true);
    setMessage(null);
    const { teeth, tablesMissing, error } = await fetchPatientToothChart(id);
    setLoading(false);

    if (tablesMissing) {
      setMessage({
        type: "info",
        text: t("docDentalChartMissing"),
      });
      setChart({});
      return;
    }

    if (error) {
      setMessage({ type: "error", text: error });
      return;
    }

    setChart(chartMapFromRows(teeth));
  }, [t]);

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
    void loadChart(patientId);
  }, [patientId, loadChart]);

  async function persistTooth(update: PatientToothState) {
    if (!patientId) return;
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

        {loading && (
          <p className="text-sm text-slate-muted">{t("docLoadingChart")}</p>
        )}

        {patientId && !loading && (
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
