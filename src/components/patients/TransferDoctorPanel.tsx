"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowRightLeft, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { Alert } from "@/components/ui/Alert";
import { formatDoctorDisplayName } from "@/lib/services/clinic-profile";
import { formatCurrency, formatDate } from "@/lib/utils";
import {
  fetchCasesWithDoctors,
  fetchPatientTransferHistory,
  type CaseWithDoctor,
  type DoctorTransferRecord,
} from "@/lib/services/patient-doctor-transfer";
import type { PatientPrimaryDoctor } from "@/lib/services/patient-primary-doctor";
import type { PatientTreatmentCase } from "@/lib/services/patient-treatment-cases";
import { createClient } from "@/lib/supabase/client";
import { translateDbError } from "@/lib/db-errors";
import type { Doctor } from "@/types";

interface TransferDoctorPanelProps {
  patientId: string;
  clinicId: string;
  treatmentCases: PatientTreatmentCase[];
  onTransferred?: (caseId: string, doctor: PatientPrimaryDoctor) => void;
}

export function TransferDoctorPanel({
  patientId,
  clinicId,
  treatmentCases,
  onTransferred,
}: TransferDoctorPanelProps) {
  const [casesWithDoctors, setCasesWithDoctors] = useState<CaseWithDoctor[]>(
    []
  );
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [history, setHistory] = useState<DoctorTransferRecord[]>([]);
  const [open, setOpen] = useState(false);
  const [selectedCaseId, setSelectedCaseId] = useState("");
  const [newDoctorId, setNewDoctorId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const load = useCallback(async () => {
    const supabase = createClient();

    const [caseRows, hist, docRes] = await Promise.all([
      fetchCasesWithDoctors(supabase, patientId, treatmentCases),
      fetchPatientTransferHistory(supabase, patientId, 8),
      supabase
        .from("doctors")
        .select("*")
        .eq("clinic_id", clinicId)
        .order("full_name_ar"),
    ]);
    setCasesWithDoctors(caseRows);
    setHistory(hist);
    if (docRes.error) {
      setError(translateDbError(docRes.error.message));
      setDoctors([]);
      return;
    }
    setDoctors((docRes.data as Doctor[]) ?? []);
  }, [patientId, clinicId, treatmentCases]);

  useEffect(() => {
    void load();
  }, [load]);

  const selectedCase = casesWithDoctors.find((c) => c.caseId === selectedCaseId);

  async function handleTransfer() {
    if (!selectedCaseId) {
      setError("اختر حالة العلاج أولاً");
      return;
    }
    if (!newDoctorId) {
      setError("اختر الطبيب الجديد");
      return;
    }
    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const res = await fetch(`/api/patients/${patientId}/transfer-doctor`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          treatment_case_id: selectedCaseId,
          doctor_id: newDoctorId,
        }),
      });
      const data = (await res.json()) as {
        error?: string;
        warning?: string;
        primaryDoctor?: PatientPrimaryDoctor;
        treatmentCaseId?: string;
      };

      if (!res.ok || data.error) {
        setError(translateDbError(data.error ?? "تعذر التحويل"));
        setLoading(false);
        return;
      }

      if (data.primaryDoctor && data.treatmentCaseId) {
        onTransferred?.(data.treatmentCaseId, data.primaryDoctor);
        setSuccess(
          `تم تحويل «${selectedCase?.caseLabel ?? "الحالة"}» إلى ${formatDoctorDisplayName(data.primaryDoctor.full_name_ar)} — الجلسات الجديدة لهذه الحالة فقط`
        );
      }
      if (data.warning) {
        setError(data.warning);
      }

      setOpen(false);
      setNewDoctorId("");
      await load();
    } catch {
      setError("تعذر الاتصال بالسيرفر");
    }
    setLoading(false);
  }

  const caseOptions = casesWithDoctors.map((c) => ({
    value: c.caseId,
    label: `${c.caseLabel}${c.doctor ? ` — ${formatDoctorDisplayName(c.doctor.full_name_ar)}` : ""}${c.remaining > 0 ? ` (متبقي ${formatCurrency(c.remaining)})` : " (مكتمل)"}`,
  }));

  const doctorOptions = doctors
    .filter((d) => d.id !== selectedCase?.doctor?.id)
    .map((d) => ({
      value: d.id,
      label: formatDoctorDisplayName(d.full_name_ar),
    }));

  if (casesWithDoctors.length === 0) {
    return null;
  }

  return (
    <div className="rounded-xl border border-slate-border bg-surface/40 px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-slate-muted">
            تحويل طبيب — لكل حالة على حدة
          </p>
          <p className="text-sm text-slate-text">
            {casesWithDoctors.length} حالة علاج — اختر الحالة ثم الطبيب الجديد
          </p>
          <p className="mt-0.5 text-[11px] text-slate-muted">
            الجلسات السابقة تبقى لطبيبها؛ التحويل يبدأ من الجلسة التالية لهذه الحالة فقط
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => {
            setOpen((v) => !v);
            setError(null);
            setSuccess(null);
            if (!open) {
              void load();
              if (!selectedCaseId && casesWithDoctors[0]) {
                setSelectedCaseId(casesWithDoctors[0].caseId);
              }
            }
          }}
        >
          <ArrowRightLeft className="h-4 w-4" />
          تحويل طبيب
        </Button>
      </div>

      {success && (
        <Alert variant="success" className="mt-3 flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          {success}
        </Alert>
      )}
      {error && !open && <Alert variant="warning" className="mt-3">{error}</Alert>}

      {open && (
        <div className="mt-3 space-y-3 border-t border-slate-border/60 pt-3">
          {error && <Alert variant="error">{error}</Alert>}

          <Select
            label="حالة العلاج"
            value={selectedCaseId}
            onChange={(e) => {
              setSelectedCaseId(e.target.value);
              setNewDoctorId("");
            }}
            placeholder="— اختر الحالة —"
            options={caseOptions}
          />

          {selectedCase && (
            <p className="text-xs text-slate-muted rounded-lg bg-white/60 px-3 py-2 border border-slate-border/50">
              الطبيب الحالي لهذه الحالة:{" "}
              <span className="font-semibold text-primary">
                {selectedCase.doctor
                  ? formatDoctorDisplayName(selectedCase.doctor.full_name_ar)
                  : "غير محدد"}
              </span>
            </p>
          )}

          <Select
            label="الطبيب الجديد"
            value={newDoctorId}
            onChange={(e) => setNewDoctorId(e.target.value)}
            placeholder="— اختر الطبيب —"
            options={doctorOptions}
            disabled={!selectedCaseId}
          />
          <p className="text-[11px] text-slate-muted">
            {doctorOptions.length > 0
              ? `${doctorOptions.length} طبيب متاح للتحويل`
              : doctors.length > 0
                ? "كل الأطباء في العيادة هم الطبيب الحالي لهذه الحالة"
                : "لا يوجد أطباء مسجلون في عيادة هذا المريض"}
          </p>

          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              onClick={handleTransfer}
              disabled={loading || !selectedCaseId || !newDoctorId}
            >
              {loading ? "جاري التحويل..." : "تأكيد التحويل"}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setOpen(false)}
              disabled={loading}
            >
              إلغاء
            </Button>
          </div>
        </div>
      )}

      {history.length > 0 && (
        <details className="mt-3 text-xs text-slate-muted">
          <summary className="cursor-pointer font-semibold">
            سجل التحويلات ({history.length})
          </summary>
          <ul className="mt-2 space-y-1">
            {history.map((h) => (
              <li key={h.id}>
                {formatDate(h.created_at)}
                {h.caseName ? ` — ${h.caseName}` : ""}: من{" "}
                {h.fromDoctorName
                  ? formatDoctorDisplayName(h.fromDoctorName)
                  : "—"}{" "}
                إلى {formatDoctorDisplayName(h.toDoctorName ?? "—")}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
