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
      if (readOnly || !selected.length) return;
      const fdi = fdiFromToothDetail(selected[0]);
      if (fdi != null) setActiveTooth(fdi);
    },
    [readOnly]
  );

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
    <div className={cn("master-odontogram space-y-3", embedded && "space-y-2")}>
      {(!embedded || isSession) && (
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

      <div className="min-h-[280px] overflow-x-auto rounded-xl border border-slate-border bg-white p-2 sm:p-4">
        <Odontogram
          className="mx-auto w-full min-h-[240px] max-w-lg"
          notation="FDI"
          layout="circle"
          showHalf="full"
          singleSelect
          readOnly={readOnly}
          showTooltip={false}
          showLabels={false}
          teethConditions={teethConditions}
          onChange={handleOdontogramChange}
          theme="light"
          colors={{
            darkBlue: "#2563eb",
            baseBlue: "#94a3b8",
            lightBlue: "#dbeafe",
          }}
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

      {markedCount > 0 && !embedded && (
        <ul className="max-h-28 space-y-0.5 overflow-y-auto text-xs text-slate-muted">
          {ALL_FDI_TEETH.filter((n) => chartMap[n]).map((n) => {
            const row = chartMap[n];
            return (
              <li key={n} className="tabular-nums">
                <span className="font-medium text-slate-text">{n}</span>:{" "}
                {TOOTH_STATUS_LABELS_AR[row.status]}
                {row.procedure_ar ? ` — ${row.procedure_ar}` : ""}
                {row.note ? ` (${row.note})` : ""}
              </li>
            );
          })}
        </ul>
      )}

      {activeTooth != null && !readOnly && (
        <ToothProcedureModal
          toothNumber={activeTooth}
          current={chartMap[activeTooth]}
          saving={savingTooth === activeTooth}
          onClose={() => setActiveTooth(null)}
          onSave={handleSave}
          onReset={handleReset}
        />
      )}
    </div>
  );
}
