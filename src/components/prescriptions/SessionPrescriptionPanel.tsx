"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { FilePen, Plus, RefreshCw, Save, Printer, Trash2, Send } from "lucide-react";
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

const EXAM_INPUT_CLASS = "mc-exam-input";
const EXAM_SELECT_CLASS = "mc-exam-input";

interface SessionPrescriptionPanelProps {
  operationId: string;
  patientId: string;
  doctorId: string;
  queueEntryId?: string | null;
  portal?: AuthPortalId;
  readOnly?: boolean;
  className?: string;
  examMode?: boolean;
  /** زر إرسال للمحاسبة — أسفل الوصفة في غرفة الكشف */
  showSendToAccounting?: boolean;
  queueStatus?: string | null;
  onSendToAccounting?: () => void | Promise<void>;
  sendingToAccounting?: boolean;
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
  showSendToAccounting = false,
  queueStatus,
  onSendToAccounting,
  sendingToAccounting = false,
}: SessionPrescriptionPanelProps) {
  const isReadOnlyView = readOnly;

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
  const autoSaveReady = useRef(false);
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const linesRef = useRef(lines);
  const diagnosisRef = useRef(diagnosis);
  const notesRef = useRef(notes);
  const saveInFlightRef = useRef(false);
  const pendingSilentSaveRef = useRef(false);

  useEffect(() => {
    linesRef.current = lines;
  }, [lines]);

  useEffect(() => {
    diagnosisRef.current = diagnosis;
  }, [diagnosis]);

  useEffect(() => {
    notesRef.current = notes;
  }, [notes]);

  function withTrailingEmptyLine(meds: PrescriptionMedication[]): PrescriptionMedication[] {
    if (meds.length === 0) return [emptyLine()];
    const last = meds[meds.length - 1];
    if (last.drug_name_ar.trim()) return [...meds, emptyLine()];
    return meds;
  }

  const load = useCallback(async () => {
    if (saveInFlightRef.current) return;
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
      } else if (!isReadOnlyView) {
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
  }, [operationId, portal, isReadOnlyView, queueEntryId]);

  useEffect(() => {
    autoSaveReady.current = false;
  }, [operationId]);

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

  async function handleSave(silent = false) {
    if (saveInFlightRef.current) {
      if (silent) pendingSilentSaveRef.current = true;
      return;
    }

    const currentLines = linesRef.current;
    const currentDiagnosis = diagnosisRef.current;
    const currentNotes = notesRef.current;
    const meds = currentLines.filter((line) => line.drug_name_ar.trim());
    if (meds.length === 0) {
      if (!silent) {
        setError("أضف اسم دواء واحد على الأقل قبل الحفظ");
      }
      return;
    }

    saveInFlightRef.current = true;
    if (!silent) {
      setSaving(true);
      setError(null);
      setSuccess(null);
    }
    try {
      const saved = await savePrescription(
        {
          operationId,
          patientId,
          doctorId,
          queueEntryId,
          diagnosisAr: currentDiagnosis,
          notesAr: currentNotes,
          medications: meds,
        },
        portal
      );
      setPrescription(saved);
      // الحفظ الصامت: لا نلمس الحقول — يمنع مسح ما يكتبه الطبيب أثناء الكتابة
      if (!silent) {
        setLines(withTrailingEmptyLine(meds));
        setSuccess("✓ تم حفظ الوصفة — ستظهر للمحاسب للطباعة");
      }
    } catch (e) {
      if (!silent) {
        setError(e instanceof Error ? e.message : "تعذر حفظ الوصفة");
      }
    } finally {
      saveInFlightRef.current = false;
      if (!silent) {
        setSaving(false);
      }
      if (pendingSilentSaveRef.current) {
        pendingSilentSaveRef.current = false;
        void handleSave(true);
      }
    }
  }

  useEffect(() => {
    if (!examMode || isReadOnlyView || loading) return;

    if (!autoSaveReady.current) {
      autoSaveReady.current = true;
      return;
    }

    const meds = lines.filter((line) => line.drug_name_ar.trim());
    if (meds.length === 0) return;

    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(() => {
      void handleSave(true);
    }, 2200);

    return () => {
      if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    };
  }, [diagnosis, notes, lines, examMode, isReadOnlyView, loading]);

  const canSendToAccounting =
    showSendToAccounting &&
    !!queueEntryId &&
    (queueStatus === "in_progress" || queueStatus === "called");

  const canPrint =
    portal === "accountant" &&
    !!prescription &&
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
        examMode && "mc-exam-prescription-card",
        className
      )}
    >
      <div
        className={cn(
          "mb-3 flex flex-wrap items-start justify-between gap-2",
          examMode && "border-b border-violet-200 pb-3"
        )}
      >
        <div className="flex items-start gap-3">
          {examMode && (
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-violet-600 text-white shadow-sm">
              <FilePen className="h-4 w-4" />
            </div>
          )}
          <div>
            <h3
              className={
                examMode
                  ? "text-base font-bold text-violet-900"
                  : "flex items-center gap-2 text-base font-bold text-slate-800"
              }
            >
              {!examMode && <FilePen className="h-4 w-4 text-primary" />}
              الوصفة الذكية
            </h3>
            <p className={cn("mt-1 text-xs", examMode ? "text-violet-700/80" : "text-slate-500")}>
            {isReadOnlyView
              ? "وصفة الطبيب لهذه الجلسة — اطبعها وسلّمها للمراجع"
              : portal === "accountant"
                ? "أضف أو عدّل الوصفة إذا نسيها الطبيب — تُحفظ مع الجلسة"
                : examMode
                  ? "اكتب الوصفة — تُحفظ تلقائياً مع الجلسة"
                  : "اكتب الوصفة أو اختر قالباً — تُحفظ مع الجلسة وتصل للمحاسب"}
            </p>
          </div>
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
          {examMode && saving && (
            <span className="text-[11px] font-medium text-violet-700">جاري الحفظ...</span>
          )}
          {examMode && prescription && !saving && (
            <span className="text-[11px] font-medium text-emerald-700">محفوظ</span>
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

      {!loading && isReadOnlyView && !prescription && (
        <p className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-4 text-sm text-slate-muted">
          لم يكتب الطبيب وصفة لهذه الجلسة بعد.
        </p>
      )}

      {!loading && (!isReadOnlyView || prescription) && (
        <div
          className={
            examMode
              ? "mc-exam-prescription-inner"
              : "space-y-3 rounded-xl border border-primary/15 bg-primary/[0.03] p-4"
          }
        >
          {!isReadOnlyView && (
            <Select
              label="قالب جاهز (اختياري)"
              value={templateId}
              onChange={(e) => applyTemplate(e.target.value)}
              placeholder="— اختر قالب —"
              className={examMode ? EXAM_SELECT_CLASS : undefined}
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
            disabled={isReadOnlyView}
            placeholder="مثال: التهاب لثة / ألم أسنان"
            className={examMode ? EXAM_INPUT_CLASS : undefined}
          />

          <div className="space-y-2">
            <p className={examMode ? "mc-exam-label" : "mc-label"}>الأدوية</p>
            {lines.map((line, index) => (
              <div
                key={index}
                className={cn(
                  "grid gap-2 rounded-lg border bg-white p-3 sm:grid-cols-2",
                  examMode ? "mc-exam-med-row" : "border-slate-border"
                )}
              >
                <Input
                  label="اسم الدواء"
                  value={line.drug_name_ar}
                  onChange={(e) =>
                    updateLine(index, { drug_name_ar: e.target.value })
                  }
                  disabled={isReadOnlyView}
                  className={examMode ? EXAM_INPUT_CLASS : undefined}
                />
                <Input
                  label="الجرعة"
                  value={line.dosage ?? ""}
                  onChange={(e) => updateLine(index, { dosage: e.target.value })}
                  disabled={isReadOnlyView}
                  placeholder="500mg"
                  className={examMode ? EXAM_INPUT_CLASS : undefined}
                />
                <Input
                  label="التكرار"
                  value={line.frequency ?? ""}
                  onChange={(e) =>
                    updateLine(index, { frequency: e.target.value })
                  }
                  disabled={isReadOnlyView}
                  placeholder="3 مرات يومياً"
                  className={examMode ? EXAM_INPUT_CLASS : undefined}
                />
                <Input
                  label="المدة"
                  value={line.duration ?? ""}
                  onChange={(e) =>
                    updateLine(index, { duration: e.target.value })
                  }
                  disabled={isReadOnlyView}
                  placeholder="5 أيام"
                  className={examMode ? EXAM_INPUT_CLASS : undefined}
                />
                <div className="sm:col-span-2">
                  <Input
                    label="تعليمات"
                    value={line.instructions ?? ""}
                    onChange={(e) =>
                      updateLine(index, { instructions: e.target.value })
                    }
                    disabled={isReadOnlyView}
                    placeholder="بعد الأكل"
                    className={examMode ? EXAM_INPUT_CLASS : undefined}
                  />
                </div>
                {!isReadOnlyView && lines.length > 1 && (
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

            {!isReadOnlyView && (
              <Button type="button" variant="outline" size="sm" onClick={addLine}>
                <Plus className="h-4 w-4" />
                إضافة دواء
              </Button>
            )}
          </div>

          <div>
            <label className={cn("mb-1.5", examMode ? "mc-exam-label" : "mc-label")}>
              ملاحظات للمراجع
            </label>
            <textarea
              className={cn(
                "w-full rounded-lg border px-3 py-2 text-sm disabled:opacity-70",
                examMode
                  ? "mc-exam-input min-h-[72px]"
                  : "border-slate-border bg-surface-card focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
              )}
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              disabled={isReadOnlyView}
              placeholder="تعليمات عامة..."
            />
          </div>

          {!isReadOnlyView && !examMode && (
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

          {canSendToAccounting && onSendToAccounting && (
            <button
              type="button"
              onClick={() => void onSendToAccounting()}
              disabled={sendingToAccounting}
              className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 py-3.5 text-sm font-bold text-white shadow-md disabled:opacity-60"
            >
              {sendingToAccounting ? (
                <RefreshCw className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
              إرسال للمحاسبة (حفظ الجلسة)
            </button>
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
