"use client";

import { useCallback, useRef } from "react";
import { Upload, X, Smile } from "lucide-react";
import { InteractiveDentalChart } from "@/components/clinical/InteractiveDentalChart";
import type { SessionClinicalDraft } from "@/lib/clinical/constants";
import { saveSessionClinicalRecords } from "@/lib/clinical/session-records";
import type { AuthPortalId } from "@/lib/auth/portal-access";
import { authPortalHeaders } from "@/lib/auth/api-portal";
import { cn } from "@/lib/utils";

export interface SessionClinicalRecordProps {
  value: SessionClinicalDraft;
  onChange: (draft: SessionClinicalDraft) => void;
  disabled?: boolean;
  chartResetKey?: number;
  showHeader?: boolean;
  examLayout?: boolean;
  /** حفظ تلقائي عند تعديل المخطط أو رفع الأشعة — غرفة الكشف */
  autoSave?: boolean;
  operationId?: string;
  portal?: AuthPortalId;
  onAutoSaved?: () => void;
  onAutoSaveError?: (message: string) => void;
}

function XrayUploadSection({
  value,
  onChange,
  disabled,
  fileRef,
  examLayout,
  autoSave,
  operationId,
  portal = "doctor",
  onAutoSaved,
  onAutoSaveError,
}: {
  value: SessionClinicalDraft;
  onChange: (draft: SessionClinicalDraft) => void;
  disabled?: boolean;
  fileRef: React.RefObject<HTMLInputElement | null>;
  examLayout?: boolean;
  autoSave?: boolean;
  operationId?: string;
  portal?: AuthPortalId;
  onAutoSaved?: () => void;
  onAutoSaveError?: (message: string) => void;
}) {
  async function uploadFiles(files: File[]) {
    if (!operationId) return;
    for (const file of files) {
      const form = new FormData();
      form.append("operation_id", operationId);
      form.append("file", file);
      const res = await fetch("/api/clinical/xray-upload", {
        method: "POST",
        credentials: "same-origin",
        headers: authPortalHeaders(portal),
        body: form,
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        onAutoSaveError?.(json.error ?? "تعذر رفع صورة الأشعة");
        return;
      }
    }
    onAutoSaved?.();
  }

  function addFiles(files: FileList | null) {
    if (!files?.length) return;
    const allowed = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
    const picked = Array.from(files).filter(
      (f) => allowed.includes(f.type) || f.type.startsWith("image/")
    );
    if (picked.length === 0) return;

    if (autoSave && operationId) {
      void uploadFiles(picked);
      return;
    }

    onChange({ ...value, xrayFiles: [...value.xrayFiles, ...picked] });
  }

  function removeFile(index: number) {
    const next = value.xrayFiles.filter((_, i) => i !== index);
    onChange({ ...value, xrayFiles: next });
  }

  return (
    <>
      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,application/pdf"
        multiple
        className="hidden"
        disabled={disabled}
        onChange={(e) => {
          addFiles(e.target.files);
          e.target.value = "";
        }}
      />
      <button
        type="button"
        disabled={disabled}
        onClick={() => fileRef.current?.click()}
        className={cn(
          "flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed py-4 text-sm font-medium transition-colors disabled:opacity-50",
          examLayout
            ? "border-cyan-400/60 bg-cyan-50/80 text-cyan-800 hover:bg-cyan-100"
            : "border-teal-300 bg-white text-teal-800 hover:bg-teal-50"
        )}
      >
        <Upload className="h-4 w-4" />
        {autoSave ? "رفع أشعة — تُحفظ مباشرة" : "رفع صور أشعة لهذه الجلسة"}
      </button>
      {!autoSave && value.xrayFiles.length > 0 && (
        <ul className="mt-2 space-y-1">
          {value.xrayFiles.map((f, i) => (
            <li
              key={`${f.name}-${i}`}
              className="flex items-center justify-between rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs"
            >
              <span className="truncate text-slate-700">{f.name}</span>
              <button
                type="button"
                disabled={disabled}
                onClick={() => removeFile(i)}
                className="text-slate-400 hover:text-red-600"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

export function SessionClinicalRecord({
  value,
  onChange,
  disabled,
  chartResetKey,
  showHeader = true,
  examLayout = false,
  autoSave = false,
  operationId,
  portal = "doctor",
  onAutoSaved,
  onAutoSaveError,
}: SessionClinicalRecordProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const teethSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const persistTeeth = useCallback(
    async (teeth: SessionClinicalDraft["teeth"]) => {
      if (!autoSave || !operationId || Object.keys(teeth).length === 0) return;
      const res = await saveSessionClinicalRecords(
        operationId,
        { teeth, xrayFiles: [] },
        portal
      );
      if (!res.ok) {
        onAutoSaveError?.(res.error ?? "تعذر حفظ مخطط الأسنان");
        return;
      }
      onAutoSaved?.();
    },
    [autoSave, operationId, portal, onAutoSaved, onAutoSaveError]
  );

  const handleTeethChange = useCallback(
    (teeth: SessionClinicalDraft["teeth"]) => {
      onChange({ ...value, teeth });
      if (!autoSave || disabled) return;
      if (teethSaveTimer.current) clearTimeout(teethSaveTimer.current);
      teethSaveTimer.current = setTimeout(() => {
        void persistTeeth(teeth);
      }, 350);
    },
    [autoSave, disabled, onChange, persistTeeth, value]
  );

  if (examLayout) {
    return (
      <div className="space-y-4">
        <div className="mc-exam-xray-card">
          <h4 className="mc-exam-section-header">
            <Upload className="h-4 w-4 text-cyan-600" />
            <span className="text-cyan-800">صور الأشعة (X-ray)</span>
          </h4>
          <XrayUploadSection
            value={value}
            onChange={onChange}
            disabled={disabled}
            fileRef={fileRef}
            examLayout
            autoSave={autoSave}
            operationId={operationId}
            portal={portal}
            onAutoSaved={onAutoSaved}
            onAutoSaveError={onAutoSaveError}
          />
        </div>

        <div className="mc-exam-record-card">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-primary/15 pb-2.5">
            <h4 className="flex items-center gap-2 text-sm font-bold text-primary">
              <Smile className="h-4 w-4" />
              مخطط الأسنان التفاعلي
            </h4>
            <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-[11px] font-semibold text-primary tabular-nums">
              {Object.keys(value.teeth).length} سن مسجّل
            </span>
          </div>
          <InteractiveDentalChart
            key={chartResetKey}
            mode="session"
            value={value.teeth}
            onChange={handleTeethChange}
            readOnly={disabled}
            embedded
            examCanvas
          />
          <div className="mt-3 rounded-lg border border-primary/20 bg-primary/10 px-3 py-2">
            <p className="text-[11px] font-semibold text-primary">
              اضغط على السن — يُحفظ تلقائياً دون زر حفظ
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 rounded-xl border border-teal-200/60 bg-teal-50/30 p-4">
      {showHeader && (
        <>
          <div className="flex items-center gap-2">
            <Upload className="h-5 w-5 text-teal-700" />
            <h3 className="text-base font-semibold text-slate-text">
              السجل الطبي البصري
            </h3>
          </div>
          <p className="text-xs text-slate-muted">
            خاص بهذه الجلسة فقط — كل زيارة لها أشعتها ومخططها (لا يظهر على جلسات
            أخرى)
          </p>
        </>
      )}

      <div>
        <p className="mb-2 text-sm font-medium text-slate-text">صور الأشعة (X-ray)</p>
        <XrayUploadSection
          value={value}
          onChange={onChange}
          disabled={disabled}
          fileRef={fileRef}
          autoSave={autoSave}
          operationId={operationId}
          portal={portal}
          onAutoSaved={onAutoSaved}
          onAutoSaveError={onAutoSaveError}
        />
      </div>

      <InteractiveDentalChart
        key={chartResetKey}
        mode="session"
        value={value.teeth}
        onChange={handleTeethChange}
        readOnly={disabled}
        embedded
      />
    </div>
  );
}
