"use client";

import { useCallback, useEffect, useState } from "react";
import { FilePen, Plus, RefreshCw, Save, Printer, Trash2 } from "lucide-react";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { PrescriptionPrintModal } from "@/components/prescriptions/PrescriptionPrintModal";
import {
  fetchPrescriptionByOperation,
  savePrescription,
} from "@/lib/prescriptions/client";
import { PRESCRIPTION_TEMPLATES } from "@/lib/prescriptions/templates";
import type {
  PatientPrescription,
  PrescriptionMedication,
} from "@/lib/prescriptions/types";
import type { AuthPortalId } from "@/lib/auth/portal-access";
import { cn } from "@/lib/utils";

const emptyLine = (): PrescriptionMedication => ({ drug_name_ar: "" });

interface SessionPrescriptionPanelProps {
  operationId: string;
  patientId: string;
  doctorId: string;
  queueEntryId?: string | null;
  portal?: AuthPortalId;
  readOnly?: boolean;
  className?: string;
  examMode?: boolean;
}

export function SessionPrescriptionPanel({
  operationId,
  patientId,
  doctorId,
  queueEntryId,
  portal = "doctor",
  readOnly = false,
  className,
  examMode = false,
}: SessionPrescriptionPanelProps) {
  const isAccountant = readOnly || portal === "accountant";

  const [prescription, setPrescription] = useState<PatientPrescription | null>(
    null
  );
  const [diagnosis, setDiagnosis] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<PrescriptionMedication[]>([emptyLine()]);
  const [templateId, setTemplateId] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [showPrint, setShowPrint] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const existing = await fetchPrescriptionByOperation(
        operationId,
        portal,
        queueEntryId
      );
      if (existing) {
        setPrescription(existing);
        setDiagnosis(existing.diagnosis_ar ?? "");
        setNotes(existing.notes_ar ?? "");
        setLines(
          existing.medications.length > 0
            ? existing.medications
            : [emptyLine()]
        );
      } else if (!isAccountant) {
        setPrescription(null);
        setDiagnosis("");
        setNotes("");
        setLines([emptyLine()]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "تعذر تحميل الوصفة");
    } finally {
      setLoading(false);
    }
  }, [operationId, portal, isAccountant, queueEntryId]);

  useEffect(() => {
    void load();
  }, [load]);

  function applyTemplate(id: string) {
    setTemplateId(id);
    const tpl = PRESCRIPTION_TEMPLATES.find((t) => t.id === id);
    if (!tpl) return;
    if (tpl.diagnosis_ar) setDiagnosis(tpl.diagnosis_ar);
    setLines(tpl.medications.map((m) => ({ ...m })));
  }

  function updateLine(index: number, patch: Partial<PrescriptionMedication>) {
    setLines((prev) =>
      prev.map((line, i) => (i === index ? { ...line, ...patch } : line))
    );
  }

  function addLine() {
    setLines((prev) => [...prev, emptyLine()]);
  }

  function removeLine(index: number) {
    setLines((prev) =>
      prev.length <= 1 ? [emptyLine()] : prev.filter((_, i) => i !== index)
    );
  }

  async function handleSave() {
    const meds = lines.filter((line) => line.drug_name_ar.trim());
    if (meds.length === 0) {
      setError("أضف اسم دواء واحد على الأقل قبل الحفظ");
      return;
    }

    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const saved = await savePrescription(
        {
          operationId,
          patientId,
          doctorId,
          queueEntryId,
          diagnosisAr: diagnosis,
          notesAr: notes,
          medications: meds,
        },
        portal
      );
      setPrescription(saved);
      setLines(meds.length > 0 ? meds : [emptyLine()]);
      setSuccess("✓ تم حفظ الوصفة — ستظهر للمحاسب للطباعة");
    } catch (e) {
      setError(e instanceof Error ? e.message : "تعذر حفظ الوصفة");
    } finally {
      setSaving(false);
    }
  }

  const canPrint =
    isAccountant &&
    prescription &&
    prescription.medications.length > 0;

  const statusLabel =
    prescription?.status === "printed"
      ? "مطبوعة"
      : prescription?.status === "finalized"
        ? "جاهزة للطباعة"
        : null;

  return (
    <div
      className={cn(
        examMode && "rounded-xl border border-slate-200 bg-white p-4 shadow-md",
        className
      )}
    >
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3
            className={
              examMode
                ? "flex items-center gap-2 text-base font-bold text-primary"
                : "flex items-center gap-2 text-base font-bold text-slate-800"
            }
          >
            <FilePen className={`h-4 w-4 ${examMode ? "text-primary" : "text-primary"}`} />
            الوصفة الذكية
          </h3>
          <p className="text-xs text-slate-500 mt-1">
            {isAccountant
              ? "وصفة الطبيب لهذه الجلسة — اطبعها وسلّمها للمراجع"
              : "اكتب الوصفة أو اختر قالباً — تُحفظ مع الجلسة وتصل للمحاسب"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {statusLabel && (
            <span
              className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                prescription?.status === "printed"
                  ? "bg-success text-success-text"
                  : "bg-primary/10 text-primary"
              }`}
            >
              {statusLabel}
            </span>
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void load()}
            disabled={loading}
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      {loading && (
        <p className="text-sm text-slate-muted">جاري تحميل الوصفة...</p>
      )}

      {error && <Alert variant="error">{error}</Alert>}
      {success && <Alert variant="success">{success}</Alert>}

      {!loading && isAccountant && !prescription && (
        <p className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-4 text-sm text-slate-muted">
          لم يكتب الطبيب وصفة لهذه الجلسة بعد.
        </p>
      )}

      {!loading && (!isAccountant || prescription) && (
        <div
          className={
            examMode
              ? "space-y-3"
              : "space-y-3 rounded-xl border border-primary/15 bg-primary/[0.03] p-4"
          }
        >
          {!isAccountant && (
            <Select
              label="قالب جاهز (اختياري)"
              value={templateId}
              onChange={(e) => applyTemplate(e.target.value)}
              placeholder="— اختر قالب —"
              options={PRESCRIPTION_TEMPLATES.map((t) => ({
                value: t.id,
                label: t.name_ar,
              }))}
            />
          )}

          <Input
            label="التشخيص"
            value={diagnosis}
            onChange={(e) => setDiagnosis(e.target.value)}
            disabled={isAccountant}
            placeholder="مثال: التهاب لثة / ألم أسنان"
            className={examMode ? "border-gray-300 bg-white" : undefined}
          />

          <div className="space-y-2">
            <p className="mc-label">الأدوية</p>
            {lines.map((line, index) => (
              <div
                key={index}
                className={cn(
                  "grid gap-2 rounded-lg border bg-white p-3 sm:grid-cols-2",
                  examMode ? "border-gray-300 shadow-sm" : "border-slate-border"
                )}
              >
                <Input
                  label="اسم الدواء"
                  value={line.drug_name_ar}
                  onChange={(e) =>
                    updateLine(index, { drug_name_ar: e.target.value })
                  }
                  disabled={isAccountant}
                  className={examMode ? "border-gray-300" : undefined}
                />
                <Input
                  label="الجرعة"
                  value={line.dosage ?? ""}
                  onChange={(e) => updateLine(index, { dosage: e.target.value })}
                  disabled={isAccountant}
                  placeholder="500mg"
                  className={examMode ? "border-gray-300" : undefined}
                />
                <Input
                  label="التكرار"
                  value={line.frequency ?? ""}
                  onChange={(e) =>
                    updateLine(index, { frequency: e.target.value })
                  }
                  disabled={isAccountant}
                  placeholder="3 مرات يومياً"
                  className={examMode ? "border-gray-300" : undefined}
                />
                <Input
                  label="المدة"
                  value={line.duration ?? ""}
                  onChange={(e) =>
                    updateLine(index, { duration: e.target.value })
                  }
                  disabled={isAccountant}
                  placeholder="5 أيام"
                  className={examMode ? "border-gray-300" : undefined}
                />
                <div className="sm:col-span-2">
                  <Input
                    label="تعليمات"
                    value={line.instructions ?? ""}
                    onChange={(e) =>
                      updateLine(index, { instructions: e.target.value })
                    }
                    disabled={isAccountant}
                    placeholder="بعد الأكل"
                    className={examMode ? "border-gray-300" : undefined}
                  />
                </div>
                {!isAccountant && lines.length > 1 && (
                  <div className="sm:col-span-2 flex justify-end">
                    <button
                      type="button"
                      onClick={() => removeLine(index)}
                      className="flex items-center gap-1 text-xs text-debt-text hover:underline"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      حذف السطر
                    </button>
                  </div>
                )}
              </div>
            ))}

            {!isAccountant && (
              <Button type="button" variant="outline" size="sm" onClick={addLine}>
                <Plus className="h-4 w-4" />
                إضافة دواء
              </Button>
            )}
          </div>

          <div>
            <label className="mc-label mb-1.5">ملاحظات للمراجع</label>
            <textarea
              className={cn(
                "w-full rounded-lg border bg-surface-card px-3 py-2 text-sm disabled:opacity-70",
                examMode
                  ? "border-gray-300 bg-white focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                  : "border-slate-border"
              )}
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              disabled={isAccountant}
              placeholder="تعليمات عامة..."
            />
          </div>

          {!isAccountant && (
            <Button
              type="button"
              className="w-full sm:w-auto"
              onClick={() => void handleSave()}
              disabled={saving}
            >
              {saving ? (
                <RefreshCw className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              حفظ الوصفة
            </Button>
          )}

          {canPrint && (
            <Button
              type="button"
              variant="outline"
              className="w-full sm:w-auto"
              onClick={() => setShowPrint(true)}
            >
              <Printer className="h-4 w-4" />
              {prescription.status === "printed"
                ? "إعادة طباعة الوصفة"
                : "طباعة الوصفة"}
            </Button>
          )}
        </div>
      )}

      {showPrint && prescription && (
        <PrescriptionPrintModal
          prescriptionId={prescription.id}
          portal={portal}
          onClose={() => setShowPrint(false)}
          onPrinted={() => {
            void load();
          }}
        />
      )}
    </div>
  );
}
