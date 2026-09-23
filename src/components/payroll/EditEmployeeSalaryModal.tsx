"use client";

import { useMemo, useState } from "react";
import { Banknote, RefreshCw } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { authPortalHeaders } from "@/lib/auth/api-portal";
import { breakdownAssistantSalary } from "@/lib/services/assistant-payroll";
import {
  ASSISTANT_COMPENSATION_LABELS,
  isDailyWageAssistant,
  isDailyWage,
  type AssistantCompensationMode,
} from "@/lib/services/assistant-compensation";
import {
  payrollCategoryLabel,
  type PayrollEmployeeCategory,
  type PayrollPerson,
} from "@/lib/services/payroll-persons";
import { formatCurrency } from "@/lib/utils";

interface EditEmployeeSalaryModalProps {
  person: PayrollPerson;
  onClose: () => void;
  onSaved: () => void;
}

export function EditEmployeeSalaryModal({
  person,
  onClose,
  onSaved,
}: EditEmployeeSalaryModalProps) {
  const [baseSalary, setBaseSalary] = useState(String(person.base_salary));
  const [jobTitle, setJobTitle] = useState(person.job_title_ar);
  const [doctorSharePct, setDoctorSharePct] = useState(
    String(person.doctor_share_percentage ?? 0)
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const [compensationMode, setCompensationMode] =
    useState<AssistantCompensationMode>(
      person.compensation_mode ?? "monthly_fixed"
    );
  const isStaffLike =
    person.category === "general" || person.category === "accountant";
  const supportsCompensationMode =
    person.category === "assistant" || isStaffLike;
  const isDaily = isDailyWage(compensationMode);

  const assistantPreview = useMemo(() => {
    if (person.category !== "assistant" || isDaily) return null;
    return breakdownAssistantSalary({
      total_salary: Number(baseSalary) || 0,
      doctor_share_percentage: Number(doctorSharePct) || 0,
    });
  }, [person.category, baseSalary, doctorSharePct, isDaily]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    const salary = isDaily ? 0 : Number(baseSalary);
    if (!isDaily && (!Number.isFinite(salary) || salary < 0)) {
      setError("أدخل الراتب بشكل صحيح");
      return;
    }

    if (person.category === "assistant") {
      const share = Number(doctorSharePct);
      if (!Number.isFinite(share) || share < 0 || share > 100) {
        setError("نسبة الطبيب بين 0 و 100");
        return;
      }
    }

    setSaving(true);
    const res = await fetch("/api/payroll/update-compensation", {
      method: "PATCH",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        ...authPortalHeaders("accountant"),
      },
      body: JSON.stringify({
        category: person.category,
        id: person.id,
        base_salary: salary,
        job_title_ar: jobTitle.trim() || undefined,
        doctor_share_percentage:
          person.category === "assistant" ? Number(doctorSharePct) : undefined,
        compensation_mode: supportsCompensationMode
          ? compensationMode
          : undefined,
      }),
    });

    const json = await res.json();
    setSaving(false);

    if (!res.ok) {
      setError(json.error ?? "تعذر الحفظ");
      return;
    }

    onSaved();
    onClose();
  }

  const category = person.category as PayrollEmployeeCategory;


  return (
    <Modal
      onClose={onClose}
      title={<>تعديل راتب — {person.full_name_ar}</>}
      subtitle={payrollCategoryLabel(category)}
      icon={Banknote}
      closeOnBackdrop={false}
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {person.category !== "assistant" &&
          person.category !== "doctor_salary" && (
          <div>
            <label className="mc-label mb-1.5">
              الوظيفة
            </label>
            <input
              type="text"
              value={jobTitle}
              onChange={(e) => setJobTitle(e.target.value)}
              className="mc-field"
            />
          </div>
        )}

        {supportsCompensationMode && (
          <div>
            <label className="mc-label mb-1.5">
              نظام التعويض
            </label>
            <select
              value={compensationMode}
              onChange={(e) =>
                setCompensationMode(
                  e.target.value === "daily_wage" ? "daily_wage" : "monthly_fixed"
                )
              }
              className="mc-field"
            >
              <option value="monthly_fixed">
                {ASSISTANT_COMPENSATION_LABELS.monthly_fixed}
              </option>
              <option value="daily_wage">
                {ASSISTANT_COMPENSATION_LABELS.daily_wage}
              </option>
            </select>
            {isDaily && (
              <p className="mt-1.5 text-xs text-primary-700">
                يُسجَّل أجر كل يوم من صفحة الرواتب — يُجمع الشهر ثم يُخصم من
                مصاريف العيادة عند التأكيد.
              </p>
            )}
          </div>
        )}

        {!(supportsCompensationMode && isDaily) && (
        <div>
          <label className="mc-label mb-1.5">
            {person.category === "assistant"
              ? "الراتب الكلي"
              : person.category === "doctor_salary"
                ? "الراتب الثابت الشهري"
                : "الراتب الشهري"}
          </label>
          <input
            type="number"
            min={0}
            step={1}
            value={baseSalary}
            onChange={(e) => setBaseSalary(e.target.value)}
            required
            dir="ltr"
            className="mc-field font-semibold tabular-nums"
          />
        </div>
        )}

        {person.category === "assistant" && (
          <div>
            <label className="mc-label mb-1.5">
              نسبة تحمّل الطبيب (%)
            </label>
            <input
              type="number"
              min={0}
              max={100}
              value={doctorSharePct}
              onChange={(e) => setDoctorSharePct(e.target.value)}
              dir="ltr"
              className="mc-field font-semibold tabular-nums"
            />
            {assistantPreview && (
              <div className="mt-2 space-y-1 rounded-xl border border-primary-200 bg-primary-50/60 px-3.5 py-2.5 text-xs text-primary-800 dark:border-primary-800 dark:bg-primary-900/20 dark:text-primary-200">
                <p>
                  من راتب {formatCurrency(assistantPreview.totalSalary)}:
                </p>
                <p>
                  الطبيب يتحمل {assistantPreview.doctorSharePercentage}% ={" "}
                  <strong>{formatCurrency(assistantPreview.doctorShare)}</strong>
                </p>
                <p>
                  العيادة تتحمل {100 - assistantPreview.doctorSharePercentage}% ={" "}
                  <strong>{formatCurrency(assistantPreview.clinicShare)}</strong>
                </p>
              </div>
            )}
          </div>
        )}

        {person.category === "doctor_salary" && (
          <p className="rounded-xl border border-warning-border bg-warning px-3.5 py-2.5 text-xs text-warning-text">
            طبيب راتب ثابت — الجلسات للعيادة. سلف/خصم/مكافأة من هذه اللوحة.
          </p>
        )}

        {person.category === "accountant" && (
          <p className="rounded-xl border border-royal-200 bg-royal-50/60 px-3.5 py-2.5 text-xs text-royal-800 dark:border-royal-800 dark:bg-royal-900/20 dark:text-royal-200">
            راتب المحاسب يُصرف كمصاريف عيادة — يظهر في قائمة رواتب الموظفين.
          </p>
        )}

        {person.category === "general" && (
          <p className="rounded-xl border border-slate-border bg-surface px-3.5 py-2.5 text-xs text-slate-muted">
            موظف خدمات — الراتب كامل من مصاريف العيادة.
          </p>
        )}

        <p className="text-xs leading-relaxed text-slate-muted">
          {person.category === "assistant"
            ? "يُحدَّث تلقائياً في سجلات الرواتب غير المُصرفة لهذا المساعد (من أي صفحة تعدّل منها)."
            : person.category === "doctor_salary"
              ? "يُحدَّث تلقائياً في قسائم الراتب غير المُصرفة — يظهر أيضاً عند تعديل الطبيب من صفحة الأطباء."
              : isStaffLike && isDaily
                ? "يُحدَّث تلقائياً في قسائم الراتب غير المُسلَّمة — صافي الشهر = مجموع أيام العمل."
                : "يُحدَّث تلقائياً في قسائم الراتب غير المُسلَّمة لموظفي العيادة."}
        </p>

        {error && (
          <p className="rounded-xl border border-debt-border bg-debt px-3.5 py-2.5 text-sm text-debt-text">
            {error}
          </p>
        )}

        <div className="flex gap-2 border-t border-slate-border pt-4">
          <button
            type="button"
            onClick={onClose}
            className="mc-btn-soft flex-1 py-2.5"
          >
            إلغاء
          </button>
          <button
            type="submit"
            disabled={saving}
            className="mc-btn-navy flex-1 py-2.5"
          >
            {saving && <RefreshCw className="h-4 w-4 animate-spin" />}
            حفظ
          </button>
        </div>
      </form>
    </Modal>
  );
}
