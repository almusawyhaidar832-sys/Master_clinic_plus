"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  CHART_PROCEDURE_OPTIONS,
  TOOTH_STATUS_LABELS_AR,
  type PatientToothState,
  type ToothStatus,
} from "@/lib/clinical/tooth-status";

interface ToothProcedureModalProps {
  toothNumber: number;
  current?: PatientToothState;
  saving?: boolean;
  onClose: () => void;
  onSave: (update: PatientToothState) => void;
  onReset: () => void;
}

export function ToothProcedureModal({
  toothNumber,
  current,
  saving = false,
  onClose,
  onSave,
  onReset,
}: ToothProcedureModalProps) {
  const [procedure, setProcedure] = useState(
    current?.procedure_ar ?? CHART_PROCEDURE_OPTIONS[0]
  );
  const [note, setNote] = useState(current?.note ?? "");
  const [status, setStatus] = useState<ToothStatus>(
    current?.status ?? "healthy"
  );

  useEffect(() => {
    setProcedure(current?.procedure_ar ?? CHART_PROCEDURE_OPTIONS[0]);
    setNote(current?.note ?? "");
    setStatus(current?.status ?? "healthy");
  }, [current, toothNumber]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="tooth-modal-title"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-md rounded-2xl border border-slate-border bg-white p-4 shadow-premium">
        <div className="mb-3 flex items-start justify-between gap-2">
          <div>
            <h3
              id="tooth-modal-title"
              className="text-base font-bold text-slate-text"
            >
              السن {toothNumber}
            </h3>
            <p className="text-xs text-slate-muted">
              اختر الحالة — يظهر لون واضح على السن ويُحفظ للطبيب والمساعد
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-slate-muted hover:bg-slate-100"
            aria-label="إغلاق"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <p className="mb-2 text-xs font-medium text-slate-text">الحالة</p>
        <div className="mb-3 flex flex-wrap gap-1.5">
          {(Object.keys(TOOTH_STATUS_LABELS_AR) as ToothStatus[]).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setStatus(s)}
              className={cn(
                "rounded-lg px-2.5 py-1 text-xs font-medium transition-colors",
                status === s
                  ? "bg-primary text-white"
                  : "border border-slate-border bg-surface text-slate-text"
              )}
            >
              {TOOTH_STATUS_LABELS_AR[s]}
            </button>
          ))}
        </div>

        <p className="mb-2 text-xs font-medium text-slate-text">الإجراء</p>
        <div className="mb-3 flex flex-wrap gap-1.5">
          {CHART_PROCEDURE_OPTIONS.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setProcedure(p)}
              className={cn(
                "rounded-lg px-2.5 py-1 text-xs font-medium transition-colors",
                procedure === p
                  ? "bg-primary/15 text-primary ring-1 ring-primary/40"
                  : "border border-slate-border bg-white text-slate-text"
              )}
            >
              {p}
            </button>
          ))}
        </div>

        <input
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="ملاحظة على هذا السن..."
          className="mb-4 w-full rounded-lg border border-slate-border px-3 py-2 text-sm"
        />

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={saving}
            onClick={() =>
              onSave({
                tooth_number: toothNumber,
                status,
                procedure_ar: procedure,
                note: note.trim() || null,
              })
            }
            className="flex-1 rounded-lg bg-primary px-4 py-2.5 text-sm font-bold text-white disabled:opacity-60"
          >
            {saving ? "جاري الحفظ..." : "حفظ"}
          </button>
          {current && (
            <button
              type="button"
              disabled={saving}
              onClick={onReset}
              className="rounded-lg border border-red-200 px-4 py-2.5 text-sm text-red-600 disabled:opacity-60"
            >
              إعادة سليم
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-4 py-2.5 text-sm text-slate-muted"
          >
            إلغاء
          </button>
        </div>
      </div>
    </div>
  );
}
