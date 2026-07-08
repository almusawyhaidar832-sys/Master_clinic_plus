"use client";

import { useCallback, useMemo, useState } from "react";
import { Odontogram } from "react-odontogram";
import type { ToothDetail } from "react-odontogram";
import "react-odontogram/style.css";
import { ALL_FDI_TEETH, type ToothRecordInput } from "@/lib/clinical/constants";
import {
  TOOTH_STATUS_COLORS,
  TOOTH_STATUS_LABELS_AR,
  buildOdontogramTeethConditions,
  chartStateToSessionTooth,
  fdiFromToothDetail,
  sessionTeethToChartMap,
  type PatientToothChartMap,
  type PatientToothState,
} from "@/lib/clinical/tooth-status";
import { ToothProcedureModal } from "@/components/clinical/ToothProcedureModal";
import { cn } from "@/lib/utils";

type InteractiveDentalChartBase = {
  readOnly?: boolean;
  savingTooth?: number | null;
  /** داخل VisualMedicalRecord — إخفاء العناوين الطويلة */
  embedded?: boolean;
  /** خلفية داكنة للمخطط — وضع غرفة الكشف */
  examCanvas?: boolean;
};

export type InteractiveDentalChartProps = InteractiveDentalChartBase &
  (
    | {
        mode?: "patient";
        value: PatientToothChartMap;
        onToothUpdate?: (update: PatientToothState) => void | Promise<void>;
        onToothReset?: (toothNumber: number) => void | Promise<void>;
      }
    | {
        mode: "session";
        value: Record<number, ToothRecordInput>;
        onChange?: (teeth: Record<number, ToothRecordInput>) => void;
      }
  );

export function InteractiveDentalChart(props: InteractiveDentalChartProps) {
  const {
    readOnly = false,
    savingTooth = null,
    embedded = false,
    examCanvas = false,
  } = props;

  const isSession = props.mode === "session";

  const chartMap = useMemo((): PatientToothChartMap => {
    if (isSession) {
      return sessionTeethToChartMap(props.value);
    }
    return props.value;
  }, [isSession, props]);

  const [activeTooth, setActiveTooth] = useState<number | null>(null);

  const markedCount = Object.keys(chartMap).length;

  const teethConditions = useMemo(
    () => buildOdontogramTeethConditions(chartMap, activeTooth),
    [chartMap, activeTooth]
  );

  const handleOdontogramChange = useCallback(
    (selected: ToothDetail[]) => {
      if (!selected.length) return;
      const fdi = fdiFromToothDetail(selected[0]);
      if (fdi == null) return;
      if (readOnly) {
        if (chartMap[fdi]) setActiveTooth(fdi);
        return;
      }
      setActiveTooth(fdi);
    },
    [readOnly, chartMap]
  );

  const canInspectTeeth = !readOnly || markedCount > 0;

  function handleSave(update: PatientToothState) {
    if (isSession) {
      if (!props.onChange) {
        setActiveTooth(null);
        return;
      }
      const tooth = chartStateToSessionTooth(update);
      props.onChange({
        ...props.value,
        [update.tooth_number]: tooth,
      });
      setActiveTooth(null);
      return;
    }

    void Promise.resolve(props.onToothUpdate?.(update)).then(() => {
      setActiveTooth(null);
    });
  }

  function handleReset() {
    if (activeTooth == null) return;

    if (isSession) {
      if (props.onChange) {
        const next = { ...props.value };
        delete next[activeTooth];
        props.onChange(next);
      }
      setActiveTooth(null);
      return;
    }

    void Promise.resolve(props.onToothReset?.(activeTooth)).then(() => {
      setActiveTooth(null);
    });
  }

  return (
    <div
      className={cn(
        "master-odontogram space-y-3",
        embedded && "space-y-2",
        examCanvas && "mc-exam-odontogram"
      )}
    >
      {!embedded && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-medium text-slate-text">
              مخطط الأسنان التفاعلي (FDI)
            </p>
            <p className="text-xs text-slate-muted tabular-nums">
              {markedCount} سن مسجّل
            </p>
          </div>

          {!readOnly && (
            <p className="text-[11px] text-slate-muted">
              اضغط على السن لفتح قائمة الإجراءات والحالة
            </p>
          )}
        </>
      )}

      <div
        className={cn(
          examCanvas
            ? "mc-exam-chart-card min-h-[300px] overflow-x-auto p-3 sm:p-4"
            : "min-h-[280px] overflow-x-auto rounded-xl border border-slate-border bg-white p-2 sm:p-4"
        )}
      >
        <Odontogram
          className="mx-auto w-full min-h-[240px] max-w-lg"
          notation="FDI"
          layout="circle"
          showHalf="full"
          singleSelect
          readOnly={!canInspectTeeth}
          showTooltip={false}
          showLabels={false}
          teethConditions={teethConditions}
          onChange={handleOdontogramChange}
          theme="light"
          colors={
            examCanvas
              ? {
                  darkBlue: "#1d4ed8",
                  baseBlue: "#475569",
                  lightBlue: "#93c5fd",
                }
              : {
                  darkBlue: "#2563eb",
                  baseBlue: "#94a3b8",
                  lightBlue: "#dbeafe",
                }
          }
        />
      </div>

      {!embedded && (
        <div className="flex flex-wrap gap-2">
          {(
            Object.keys(TOOTH_STATUS_COLORS) as (keyof typeof TOOTH_STATUS_COLORS)[]
          ).map((status) => (
            <span
              key={status}
              className="inline-flex items-center gap-1.5 rounded-full border border-slate-border bg-white px-2 py-0.5 text-[10px] text-slate-muted"
            >
              <span
                className="inline-block h-3 w-3 rounded-sm border"
                style={{
                  background: TOOTH_STATUS_COLORS[status].fill,
                  borderColor: TOOTH_STATUS_COLORS[status].stroke,
                }}
              />
              {TOOTH_STATUS_LABELS_AR[status]}
            </span>
          ))}
        </div>
      )}

      {markedCount > 0 && (
        <div
          className={cn(
            "rounded-xl border border-amber-200/80 bg-amber-50/60",
            embedded ? "p-2.5" : "p-3"
          )}
        >
          <p
            className={cn(
              "font-semibold text-amber-950",
              embedded ? "mb-1.5 text-xs" : "mb-2 text-sm"
            )}
          >
            سجل الأسنان والملاحظات ({markedCount})
          </p>
          {readOnly && (
            <p className="mb-2 text-[11px] text-amber-900/80">
              اضغط على السن في المخطط لعرض تفاصيله
            </p>
          )}
          <ul
            className={cn(
              "space-y-1.5 overflow-y-auto",
              embedded ? "max-h-36 text-[11px]" : "max-h-40 text-xs"
            )}
          >
            {ALL_FDI_TEETH.filter((n) => chartMap[n]).map((n) => {
              const row = chartMap[n];
              return (
                <li
                  key={n}
                  className={cn(
                    "rounded-lg border border-amber-100/80 bg-white/90 px-2.5 py-1.5 tabular-nums",
                    readOnly && "cursor-pointer hover:border-primary/30 hover:bg-primary/5"
                  )}
                  onClick={() => {
                    if (readOnly) setActiveTooth(n);
                  }}
                  onKeyDown={(e) => {
                    if (readOnly && (e.key === "Enter" || e.key === " ")) {
                      e.preventDefault();
                      setActiveTooth(n);
                    }
                  }}
                  role={readOnly ? "button" : undefined}
                  tabIndex={readOnly ? 0 : undefined}
                >
                  <p className="font-medium text-slate-text">
                    السن {n} — {TOOTH_STATUS_LABELS_AR[row.status]}
                    {row.procedure_ar ? ` · ${row.procedure_ar}` : ""}
                  </p>
                  {row.note?.trim() ? (
                    <p className="mt-0.5 font-medium text-amber-950">
                      ملاحظة: {row.note.trim()}
                    </p>
                  ) : (
                    <p className="mt-0.5 text-slate-muted">بدون ملاحظة</p>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {activeTooth != null && (!readOnly || chartMap[activeTooth]) && (
        <ToothProcedureModal
          toothNumber={activeTooth}
          current={chartMap[activeTooth]}
          saving={savingTooth === activeTooth}
          readOnly={readOnly}
          onClose={() => setActiveTooth(null)}
          onSave={handleSave}
          onReset={handleReset}
        />
      )}
    </div>
  );
}
