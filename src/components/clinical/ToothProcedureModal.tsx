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
  /** عرض فقط — للمحاسب وملف الجلسات */
  readOnly?: boolean;
  onClose: () => void;
  onSave: (update: PatientToothState) => void;
  onReset: () => void;
}

export function ToothProcedureModal({
  toothNumber,
  current,
  saving = false,
  readOnly = false,
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
      className="mc-modal-backdrop animate-fade-in"
      role="dialog"
      aria-modal="true"
      aria-labelledby="tooth-modal-title"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="mc-modal sm:max-w-md">
        <div className="mc-modal-head">
          <span className="mc-icon-tile h-10 w-10 rounded-xl text-sm font-bold tabular-nums" aria-hidden>
            {toothNumber}
          </span>
          <div className="min-w-0 flex-1">
            <h3
              id="tooth-modal-title"
              className="text-base font-bold text-slate-text"
            >
              السن {toothNumber}
            </h3>
            <p className="text-xs text-slate-muted">
              {readOnly
                ? "تفاصيل السن المسجّلة في هذه الجلسة"
                : "اختر الحالة — يظهر لون واضح على السن ويُحفظ للطبيب والمساعد"}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-slate-muted transition-colors hover:bg-surface hover:text-slate-text"
            aria-label="إغلاق"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="px-5 py-5">
        {readOnly ? (
          <dl className="mb-4 grid gap-3 text-sm">
            <div>
              <dt className="text-xs font-medium text-slate-muted">الحالة</dt>
              <dd className="font-medium text-slate-text">
                {TOOTH_STATUS_LABELS_AR[status]}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-slate-muted">الإجراء</dt>
              <dd className="font-medium text-slate-text">{procedure}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-slate-muted">
                ملاحظة على السن
              </dt>
              <dd className="mt-1 rounded-xl border border-warning-border bg-warning px-3 py-2 text-warning-text">
                {note.trim() || "— لا توجد ملاحظة —"}
              </dd>
            </div>
          </dl>
        ) : (
          <>
            <p className="mb-2 text-xs font-medium text-slate-text">الحالة</p>
            <div className="mb-3 flex flex-wrap gap-1.5">
              {(Object.keys(TOOTH_STATUS_LABELS_AR) as ToothStatus[]).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setStatus(s)}
                  className={cn(
                    "mc-chip px-3 py-1 text-xs",
                    status === s && "mc-chip--active"
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
                    "inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium transition-all",
                    procedure === p
                      ? "border-premium-300 bg-premium-50 text-premium-800 shadow-gold dark:bg-premium-500/10 dark:text-premium-200"
                      : "border-slate-border bg-surface-card text-slate-muted hover:border-premium-300 hover:text-slate-text"
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
              className="mc-field mb-4"
            />
          </>
        )}

        <div className="flex flex-wrap gap-2">
          {readOnly ? (
            <button
              type="button"
              onClick={onClose}
              className="mc-btn-navy flex-1 py-2.5"
            >
              إغلاق
            </button>
          ) : (
            <>
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
                className="mc-btn-navy flex-1 py-2.5"
              >
                {saving ? "جاري الحفظ..." : "حفظ"}
              </button>
              {current && (
                <button
                  type="button"
                  disabled={saving}
                  onClick={onReset}
                  className="inline-flex items-center justify-center rounded-xl border border-debt-border bg-surface-card px-4 py-2.5 text-sm font-semibold text-debt-text transition-colors hover:bg-debt disabled:opacity-60"
                >
                  إعادة سليم
                </button>
              )}
              <button
                type="button"
                onClick={onClose}
                className="mc-btn-soft py-2.5"
              >
                إلغاء
              </button>
            </>
          )}
        </div>
        </div>
      </div>
    </div>
  );
}
