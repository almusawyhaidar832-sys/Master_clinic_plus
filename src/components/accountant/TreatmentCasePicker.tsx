"use client";

import { formatCurrency } from "@/lib/utils";
import { formatDoctorDisplayName } from "@/lib/services/clinic-profile";
import type { PatientTreatmentCase } from "@/lib/services/patient-treatment-cases";
import {
  computedCaseRemaining,
  isTreatmentCaseOpenForPicker,
  isTreatmentCaseSettledForPicker,
} from "@/lib/services/patient-financial-plan";
interface TreatmentCasePickerProps {
  cases: PatientTreatmentCase[];
  onSelect: (treatmentCase: PatientTreatmentCase) => void;
  /** حالة جديدة — يُمرَّر اسم العلاج عند تكرار حالة مكتملة */
  onNewCase: (prefillTreatmentName?: string) => void;
}

export function TreatmentCasePicker({
  cases,
  onSelect,
  onNewCase,
}: TreatmentCasePickerProps) {
  const active = cases.filter((c) => isTreatmentCaseOpenForPicker(c));
  const completed = cases.filter(
    (c) => isTreatmentCaseSettledForPicker(c) && !isTreatmentCaseOpenForPicker(c)
  );

  return (
    <div className="sm:col-span-2 space-y-4">
      <div>
        <p className="mc-section-title">
          اختر الحالة التي سيعمل عليها الطبيب اليوم
        </p>
        <p className="mt-1 ps-3 text-xs text-slate-muted">
          نفس المريض قد يكون عنده أكثر من حالة (مثلاً حشوة ضوئية + تقويم) — لكل حالة سعر وذمة منفصلة
        </p>
      </div>

      <div className="grid gap-2">
        {active.length === 0 && completed.length > 0 && (
          <p className="text-xs text-warning-text">
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
            onClick={() => onSelect(c)}
            className="mc-list-row mc-hover-lift w-full justify-between border-s-4 border-s-premium-400 text-start"
          >
            <div>
              <p className="font-semibold text-slate-text">{c.treatment_name_ar}</p>
              {c.primary_doctor_name ? (
                <p className="text-xs font-medium text-primary mt-0.5">
                  د. {formatDoctorDisplayName(c.primary_doctor_name)}
                </p>
              ) : null}
              <p className="text-xs text-slate-muted tabular-nums mt-0.5">
                السعر الكلي {formatCurrency(c.case_price)}
                {c.discount_total > 0 && (
                  <> — خصم {formatCurrency(c.discount_total)}</>
                )}
              </p>
            </div>
            <div className="shrink-0 rounded-xl border border-debt-border bg-debt px-3 py-1.5 text-end">
              <p className="text-[11px] font-medium text-debt-text">المتبقي</p>
              <p className="text-lg font-black text-debt-text tabular-nums">
                {formatCurrency(computedCaseRemaining(c))}
              </p>
            </div>
          </button>
        ))}
      </div>

      {completed.length > 0 && (
        <div className="rounded-2xl border border-slate-border bg-surface p-4">
          <p className="mb-2.5 text-xs font-semibold text-slate-muted">حالات مكتملة (مرجع)</p>
          <div className="flex flex-wrap gap-2">
            {completed.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => onNewCase(c.treatment_name_ar)}
                className="mc-chip px-3 py-1 text-xs"
                title="بدء حالة جديدة بنفس نوع العلاج — سعر كلي جديد"
              >
                {c.treatment_name_ar} — ✓ مكتمل — إجمالي كلي جديد
              </button>
            ))}
          </div>
        </div>
      )}

      <button type="button" className="mc-btn-navy w-full py-3" onClick={() => onNewCase()}>
        + حالة علاج جديدة (مثلاً حشوة جذر — سعر جديد)
      </button>
    </div>
  );
}
