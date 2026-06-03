"use client";

import { formatCurrency } from "@/lib/utils";
import type { PatientTreatmentCase } from "@/lib/services/patient-treatment-cases";
import {
  FINANCIAL_EPSILON,
  isTreatmentCaseComplete,
} from "@/lib/services/patient-financial-plan";
import { Button } from "@/components/ui/Button";

interface TreatmentCasePickerProps {
  cases: PatientTreatmentCase[];
  onSelect: (caseId: string) => void;
  onNewCase: () => void;
}

export function TreatmentCasePicker({
  cases,
  onSelect,
  onNewCase,
}: TreatmentCasePickerProps) {
  const active = cases.filter(
    (c) =>
      c.remaining_balance > FINANCIAL_EPSILON ||
      !isTreatmentCaseComplete(c)
  );
  const completed = cases.filter(
    (c) =>
      isTreatmentCaseComplete(c) && c.remaining_balance <= FINANCIAL_EPSILON
  );

  return (
    <div className="sm:col-span-2 space-y-3">
      <p className="text-sm font-semibold text-slate-text">
        اختر الحالة التي سيعمل عليها الطبيب اليوم
      </p>
      <p className="text-xs text-slate-muted">
        نفس المريض قد يكون عنده أكثر من حالة (مثلاً حشوة ضوئية + تقويم) — لكل حالة سعر وذمة منفصلة
      </p>

      <div className="grid gap-2">
        {active.length === 0 && completed.length > 0 && (
          <p className="text-xs text-amber-800">
            كل الحالات مسددة — يمكنك فتح حالة جديدة أدناه.
          </p>
        )}
        {active.length > 0 && (
          <p className="text-xs text-primary font-medium">
            الحالات التي عليها ذمة — اختر واحدة لإضافة دفعة
          </p>
        )}
        {active.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => onSelect(c.id)}
            className="flex w-full items-center justify-between gap-3 rounded-xl border-2 border-primary/30 bg-white px-4 py-3 text-right transition hover:border-primary hover:bg-primary/5"
          >
            <div>
              <p className="font-semibold text-slate-text">{c.treatment_name_ar}</p>
              <p className="text-xs text-slate-muted tabular-nums mt-0.5">
                السعر الكلي {formatCurrency(c.case_price)}
                {c.discount_total > 0 && (
                  <> — خصم {formatCurrency(c.discount_total)}</>
                )}
              </p>
            </div>
            <div className="text-left shrink-0">
              <p className="text-xs text-slate-muted">المتبقي</p>
              <p className="text-lg font-bold text-debt-text tabular-nums">
                {formatCurrency(c.remaining_balance)}
              </p>
            </div>
          </button>
        ))}
      </div>

      {completed.length > 0 && (
        <div className="rounded-lg border border-slate-border bg-surface/50 p-3">
          <p className="text-xs font-medium text-slate-muted mb-2">حالات مكتملة (مرجع)</p>
          <div className="flex flex-wrap gap-2">
            {completed.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => onSelect(c.id)}
                className="rounded-full border border-slate-border bg-white px-3 py-1 text-xs text-slate-muted hover:border-primary"
              >
                {c.treatment_name_ar} — ✓ مكتمل ({formatCurrency(c.case_price)})
              </button>
            ))}
          </div>
        </div>
      )}

      <Button type="button" variant="outline" className="w-full" onClick={onNewCase}>
        + حالة علاج جديدة (مثلاً حشوة جذر — سعر جديد)
      </Button>
    </div>
  );
}
