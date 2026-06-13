"use client";

import { useCallback, useEffect, useState } from "react";
import { Scan } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { ClinicalRecordDisplay } from "@/components/clinical/ClinicalRecordDisplay";
import { SessionClinicalRecord } from "@/components/clinical/SessionClinicalRecord";
import {
  EMPTY_CLINICAL_DRAFT,
  type SessionClinicalDraft,
} from "@/lib/clinical/constants";
import {
  fetchOperationClinicalRecord,
  saveSessionClinicalRecords,
} from "@/lib/clinical/session-records";
import {
  hasClinicalData,
  type OperationClinicalData,
} from "@/lib/clinical/types";
import type { AuthPortalId } from "@/lib/auth/portal-access";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

export interface VisualMedicalRecordProps {
  /** معرّف الجلسة (patient_operations) */
  operationId?: string | null;
  /** يُحوَّل إلى operation_id من جدول invoices */
  invoiceId?: string | null;
  portal?: AuthPortalId;
  /** بيانات محمّلة مسبقاً — يقلّل الطلبات */
  initialData?: OperationClinicalData | null;
  /** مسودة قبل إنشاء الجلسة (إدخال المحاسب) */
  draft?: SessionClinicalDraft;
  onDraftChange?: (draft: SessionClinicalDraft) => void;
  collapsible?: boolean;
  defaultOpen?: boolean;
  disabled?: boolean;
  chartResetKey?: number;
  onSaved?: () => void;
  className?: string;
  compact?: boolean;
  /** عرض فقط — للمحاسب عند مراجعة سجل الطبيب (مخطط واحد بدون نموذج إضافة) */
  readOnly?: boolean;
  /** تخطيط غرفة الكشف — كارتات بيضاء وتباين أزرق */
  examMode?: boolean;
}

export function VisualMedicalRecord({
  operationId: operationIdProp,
  invoiceId,
  portal = "accountant",
  initialData = null,
  draft: externalDraft,
  onDraftChange,
  collapsible = true,
  defaultOpen = false,
  disabled = false,
  chartResetKey,
  onSaved,
  className,
  compact = false,
  readOnly = false,
  examMode = false,
}: VisualMedicalRecordProps) {
  const [open, setOpen] = useState(defaultOpen);
  const [operationId, setOperationId] = useState<string | null>(
    operationIdProp ?? null
  );
  const [existing, setExisting] = useState<OperationClinicalData | null>(
    initialData
  );
  const [loading, setLoading] = useState(false);
  const [addDraft, setAddDraft] = useState<SessionClinicalDraft>(
    EMPTY_CLINICAL_DRAFT
  );
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  const isDraftMode = externalDraft !== undefined && onDraftChange !== undefined;
  const reviewOnly =
    readOnly || (portal === "accountant" && !!operationIdProp && !isDraftMode);
  const draftValue = isDraftMode ? externalDraft : addDraft;
  const setDraft = isDraftMode ? onDraftChange : setAddDraft;

  useEffect(() => {
    setOperationId(operationIdProp ?? null);
  }, [operationIdProp]);

  useEffect(() => {
    setExisting(initialData);
  }, [initialData, operationIdProp]);

  useEffect(() => {
    if (!invoiceId || operationIdProp) return;

    async function resolveFromInvoice() {
      const supabase = createClient();
      const { data } = await supabase
        .from("invoices")
        .select("operation_id")
        .eq("id", invoiceId)
        .maybeSingle();
      if (data?.operation_id) {
        setOperationId(String(data.operation_id));
      }
    }

    void resolveFromInvoice();
  }, [invoiceId, operationIdProp]);

  const loadExisting = useCallback(async () => {
    if (!operationId) return;
    setLoading(true);
    const data = await fetchOperationClinicalRecord(operationId, portal);
    setExisting(data);
    setLoading(false);
  }, [operationId, portal]);

  useEffect(() => {
    if (!open || !operationId) return;
    if (initialData && hasClinicalData(initialData)) return;
    void loadExisting();
  }, [open, operationId, loadExisting, initialData]);

  const hasExisting = hasClinicalData(existing);

  const summaryHint = hasExisting
    ? `(${existing!.teeth.length} سن${
        existing!.xrays.length > 0 ? ` · ${existing!.xrays.length} أشعة` : ""
      })`
    : "";

  async function handleSaveAddition() {
    if (!operationId) return;
    const hasNew =
      addDraft.xrayFiles.length > 0 || Object.keys(addDraft.teeth).length > 0;
    if (!hasNew) {
      setMessage({
        type: "error",
        text: "أضف صورة أشعة أو حدّد سنّاً على المخطط",
      });
      return;
    }
    setSaving(true);
    setMessage(null);
    const res = await saveSessionClinicalRecords(operationId, addDraft, portal);
    setSaving(false);
    if (!res.ok) {
      setMessage({ type: "error", text: res.error ?? "تعذر الحفظ" });
      return;
    }
    setMessage({ type: "success", text: "✓ تم حفظ السجل البصري لهذه الجلسة" });
    setAddDraft(EMPTY_CLINICAL_DRAFT);
    await loadExisting();
    onSaved?.();
  }

  const body = (
    <div
      className={cn(
        "space-y-4",
        collapsible && !examMode
          ? "border-t border-slate-100 px-3 pb-3 pt-2"
          : examMode
            ? ""
            : "rounded-xl border border-teal-200/50 bg-teal-50/20 p-3"
      )}
    >
      {operationId && loading && (
        <p className="text-xs text-slate-500">جاري تحميل السجل...</p>
      )}

      {operationId && !loading && hasExisting && existing && (
        <div className={examMode ? "mc-exam-section" : undefined}>
          <ClinicalRecordDisplay data={existing} examLayout={examMode} />
        </div>
      )}

      {operationId && !loading && !hasExisting && !isDraftMode && (
        <p className="text-xs text-slate-500">
          لا يوجد مخطط أسنان أو صور أشعة مسجّلة لهذه الجلسة بعد
        </p>
      )}

      {!reviewOnly && (isDraftMode || operationId) && (
        <>
          {operationId && !isDraftMode && hasExisting && (
            <p className="text-xs font-semibold text-primary">
              إضافة أشعة / أسنان لهذه الجلسة
            </p>
          )}
          <SessionClinicalRecord
            value={draftValue}
            onChange={setDraft}
            disabled={disabled || saving}
            chartResetKey={chartResetKey}
            showHeader={!collapsible && !examMode}
            examLayout={examMode}
          />
        </>
      )}

      {operationId && !isDraftMode && !reviewOnly && (
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            onClick={() => void handleSaveAddition()}
            disabled={disabled || saving}
          >
            {saving ? "جاري الحفظ..." : "حفظ على هذه الجلسة"}
          </Button>
        </div>
      )}

      {message && <Alert variant={message.type}>{message.text}</Alert>}
    </div>
  );

  if (examMode) {
    return (
      <div className={cn("mc-exam-section overflow-hidden", className)}>
        <div className="mb-4 flex flex-wrap items-center gap-2 border-b border-slate-200 bg-gradient-to-r from-blue-50 to-indigo-50/80 px-1 pb-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-white shadow-sm">
            <Scan className="h-5 w-5" />
          </div>
          <div>
            <h4 className="text-base font-bold text-primary">السجل السريري</h4>
            {summaryHint && (
              <span className="text-xs text-slate-600">{summaryHint}</span>
            )}
          </div>
        </div>
        {body}
      </div>
    );
  }

  if (!collapsible) {
    return (
      <div className={cn("sm:col-span-2", className)}>
        {body}
      </div>
    );
  }

  return (
    <details
      className={cn(
        "rounded-lg border border-teal-200/50 bg-teal-50/20",
        compact ? "text-xs" : "",
        className
      )}
      open={open}
      onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}
    >
      <summary className="cursor-pointer list-none px-3 py-2.5 text-sm font-medium text-teal-900 [&::-webkit-details-marker]:hidden">
        <span className="inline-flex items-center gap-2">
          <Scan className={cn("h-4 w-4", compact && "h-3.5 w-3.5")} />
          السجل الطبي البصري
          {summaryHint && (
            <span className="text-xs font-normal text-teal-700/80">
              {summaryHint}
            </span>
          )}
        </span>
      </summary>
      {body}
    </details>
  );
}
