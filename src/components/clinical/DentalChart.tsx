"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import {
  ALL_FDI_TEETH,
  LOWER_LEFT,
  LOWER_RIGHT,
  TOOTH_PROCEDURES,
  type ToothRecordInput,
  UPPER_LEFT,
  UPPER_RIGHT,
} from "@/lib/clinical/constants";

export interface DentalChartProps {
  value: Record<number, ToothRecordInput>;
  onChange?: (teeth: Record<number, ToothRecordInput>) => void;
  disabled?: boolean;
  /** عرض فقط — بدون تعديل */
  readOnly?: boolean;
}

function ToothButton({
  num,
  record,
  selected,
  disabled,
  onSelect,
}: {
  num: number;
  record?: ToothRecordInput;
  selected: boolean;
  disabled?: boolean;
  onSelect: (n: number) => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onSelect(num)}
      title={record ? `${num}: ${record.procedure_ar}` : `سن ${num}`}
      className={cn(
        "flex h-9 w-9 min-h-[36px] min-w-[36px] touch-manipulation items-center justify-center rounded-lg border text-[11px] font-semibold tabular-nums transition-all sm:h-10 sm:w-10",
        record
          ? "border-primary bg-primary/15 text-primary shadow-sm"
          : "border-slate-border bg-white text-slate-muted hover:border-primary/50",
        selected && "ring-2 ring-primary ring-offset-1",
        disabled && "opacity-50 cursor-not-allowed"
      )}
    >
      {num}
    </button>
  );
}

function ToothRow({
  teeth,
  value,
  activeTooth,
  disabled,
  onSelect,
}: {
  teeth: readonly number[];
  value: Record<number, ToothRecordInput>;
  activeTooth: number | null;
  disabled?: boolean;
  onSelect: (n: number) => void;
}) {
  return (
    <div className="flex flex-wrap justify-center gap-1">
      {teeth.map((n) => (
        <ToothButton
          key={n}
          num={n}
          record={value[n]}
          selected={activeTooth === n}
          disabled={disabled}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}

export function DentalChart({
  value,
  onChange,
  disabled,
  readOnly,
}: DentalChartProps) {
  const [activeTooth, setActiveTooth] = useState<number | null>(null);
  const [procedure, setProcedure] = useState<string>(TOOTH_PROCEDURES[0]);
  const [note, setNote] = useState("");
  const isLocked = disabled || readOnly;

  function openTooth(n: number) {
    if (isLocked) return;
    setActiveTooth(n);
    const existing = value[n];
    setProcedure(existing?.procedure_ar ?? TOOTH_PROCEDURES[0]);
    setNote(existing?.note ?? "");
  }

  function applyTooth() {
    if (activeTooth == null) return;
    const next = { ...value };
    next[activeTooth] = {
      tooth_number: activeTooth,
      procedure_ar: procedure,
      note: note.trim() || undefined,
    };
    onChange?.(next);
    setActiveTooth(null);
  }

  function removeTooth() {
    if (activeTooth == null) return;
    const next = { ...value };
    delete next[activeTooth];
    onChange?.(next);
    setActiveTooth(null);
  }

  const markedCount = Object.keys(value).length;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium text-slate-text">مخطط الأسنان (FDI)</p>
        <p className="text-xs text-slate-muted tabular-nums">
          {markedCount} سن محدد
        </p>
      </div>

      {!readOnly && (
        <p className="text-[11px] text-slate-muted">
          اضغط على أي سن لتحديد إجراء — يعمل من الآيباد والماوس
        </p>
      )}

      <div className="rounded-xl border border-slate-border bg-surface/80 p-3 space-y-3">
        <div>
          <p className="mb-1 text-center text-[10px] text-slate-muted">الفك العلوي</p>
          <div className="flex flex-col gap-2 sm:flex-row sm:justify-center sm:gap-4">
            <ToothRow
              teeth={UPPER_RIGHT}
              value={value}
              activeTooth={activeTooth}
              disabled={isLocked}
              onSelect={openTooth}
            />
            <div className="hidden w-px bg-slate-border sm:block" />
            <ToothRow
              teeth={UPPER_LEFT}
              value={value}
              activeTooth={activeTooth}
              disabled={isLocked}
              onSelect={openTooth}
            />
          </div>
        </div>

        <div className="border-t border-dashed border-slate-border" />

        <div>
          <p className="mb-1 text-center text-[10px] text-slate-muted">الفك السفلي</p>
          <div className="flex flex-col gap-2 sm:flex-row sm:justify-center sm:gap-4">
            <ToothRow
              teeth={LOWER_RIGHT}
              value={value}
              activeTooth={activeTooth}
              disabled={isLocked}
              onSelect={openTooth}
            />
            <div className="hidden w-px bg-slate-border sm:block" />
            <ToothRow
              teeth={LOWER_LEFT}
              value={value}
              activeTooth={activeTooth}
              disabled={isLocked}
              onSelect={openTooth}
            />
          </div>
        </div>
      </div>

      {!readOnly && activeTooth != null && (
        <div className="rounded-xl border-2 border-primary/30 bg-primary/5 p-3 space-y-2">
          <p className="text-sm font-semibold text-primary tabular-nums">
            السن {activeTooth}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {TOOTH_PROCEDURES.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setProcedure(p)}
                className={cn(
                  "rounded-lg px-2.5 py-1 text-xs font-medium transition-colors",
                  procedure === p
                    ? "bg-primary text-white"
                    : "bg-white border border-slate-border text-slate-text"
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
            className="w-full rounded-lg border border-slate-border bg-white px-3 py-2 text-sm"
          />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={applyTooth}
              className="rounded-lg bg-primary px-4 py-2 text-xs font-bold text-white"
            >
              حفظ على السن
            </button>
            {value[activeTooth] && (
              <button
                type="button"
                onClick={removeTooth}
                className="rounded-lg border border-red-200 px-4 py-2 text-xs text-red-600"
              >
                إزالة التحديد
              </button>
            )}
            <button
              type="button"
              onClick={() => setActiveTooth(null)}
              className="rounded-lg px-3 py-2 text-xs text-slate-muted"
            >
              إلغاء
            </button>
          </div>
        </div>
      )}

      {markedCount > 0 && (
        <ul className="text-xs text-slate-muted space-y-0.5 max-h-24 overflow-y-auto">
          {ALL_FDI_TEETH.filter((n) => value[n]).map((n) => (
            <li key={n} className="tabular-nums">
              <span className="font-medium text-slate-text">{n}</span>:{" "}
              {value[n].procedure_ar}
              {value[n].note ? ` — ${value[n].note}` : ""}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
