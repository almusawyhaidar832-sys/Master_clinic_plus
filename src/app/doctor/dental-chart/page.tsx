"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { Alert } from "@/components/ui/Alert";
import { PatientSearchField } from "@/components/patients/PatientSearchField";
import { InteractiveDentalChart } from "@/components/clinical/InteractiveDentalChart";
import { ModuleGuard } from "@/components/layout/ModuleGuard";
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
        text: "جدول مخطط الأسنان غير مُنشأ بعد — شغّل سكربت 30-patient-tooth-states.sql في Supabase. سجل الجلسات الحالي يعمل كالمعتاد.",
      });
      setChart({});
      return;
    }

    if (error) {
      setMessage({ type: "error", text: error });
      return;
    }

    setChart(chartMapFromRows(teeth));
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
    setMessage({ type: "success", text: `تم حفظ السن ${update.tooth_number}` });
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
    setMessage({ type: "success", text: `تمت إعادة السن ${toothNumber} إلى سليم` });
  }

  return (
    <ModuleGuard module="dental_chart">
      <div className="space-y-4">
        <div>
          <h2 className="text-lg font-bold text-slate-text">مخطط الأسنان</h2>
          <p className="text-sm text-slate-muted">
            مخطط تراكمي للمريض — منفصل عن سجل الجلسات
          </p>
        </div>

        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-slate-text">
            اختر المراجع
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
            placeholder="اكتب أول حرفين من اسم المراجع..."
            inputClassName="h-10"
          />
        </div>

        {patientId && patientName && (
          <p className="text-sm text-slate-text">
            المراجع: <strong>{patientName}</strong>
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
          <p className="text-sm text-slate-muted">جاري تحميل المخطط...</p>
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
            اختر مراجعاً لعرض مخطط أسنانه
          </p>
        )}
      </div>
    </ModuleGuard>
  );
}

export default function DoctorDentalChartPage() {
  return (
    <Suspense fallback={<p className="text-slate-muted">جاري التحميل...</p>}>
      <DentalChartContent />
    </Suspense>
  );
}
