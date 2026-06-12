"use client";

import { useMemo, useState } from "react";
import { X, RefreshCw } from "lucide-react";
import { authPortalHeaders } from "@/lib/auth/api-portal";
import { breakdownAssistantSalary } from "@/lib/services/assistant-payroll";
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

  const assistantPreview = useMemo(() => {
    if (person.category !== "assistant") return null;
    return breakdownAssistantSalary({
      total_salary: Number(baseSalary) || 0,
      doctor_share_percentage: Number(doctorSharePct) || 0,
    });
  }, [person.category, baseSalary, doctorSharePct]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    const salary = Number(baseSalary);
    if (!Number.isFinite(salary) || salary < 0) {
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
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center">
      <div className="w-full max-w-md rounded-t-2xl bg-white p-6 shadow-xl sm:rounded-2xl">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-slate-800">
              تعديل راتب — {person.full_name_ar}
            </h2>
            <p className="text-xs text-slate-500">
              {payrollCategoryLabel(category)}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 hover:bg-slate-100"
          >
            <X className="h-5 w-5 text-slate-400" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {person.category !== "assistant" &&
            person.category !== "doctor_salary" && (
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-600">
                الوظيفة
              </label>
              <input
                type="text"
                value={jobTitle}
                onChange={(e) => setJobTitle(e.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm"
              />
            </div>
          )}

          <div>
            <label className="mb-1 block text-sm font-medium text-slate-600">
              {person.category === "assistant"
                ? "الراتب الكلي"
                : person.category === "doctor_salary"
                  ? "الراتب الثابت الشهري"
                  : "الراتب الشهري"}
            </label>
            <input
              type="number"
              min={0}
              step="1000"
              value={baseSalary}
              onChange={(e) => setBaseSalary(e.target.value)}
              required
              dir="ltr"
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm"
            />
          </div>

          {person.category === "assistant" && (
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-600">
                نسبة تحمّل الطبيب (%)
              </label>
              <input
                type="number"
                min={0}
                max={100}
                value={doctorSharePct}
                onChange={(e) => setDoctorSharePct(e.target.value)}
                dir="ltr"
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm"
              />
              {assistantPreview && (
                <div className="mt-2 space-y-1 rounded-lg bg-teal-50 px-3 py-2 text-xs text-teal-900">
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
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
              طبيب راتب ثابت — الجلسات للعيادة. سلف/خصم/مكافأة من هذه اللوحة.
            </p>
          )}

          {person.category === "accountant" && (
            <p className="rounded-lg bg-violet-50 px-3 py-2 text-xs text-violet-800">
              راتب المحاسب يُصرف كمصاريف عيادة — يظهر في قائمة رواتب الموظفين.
            </p>
          )}

          {person.category === "general" && (
            <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
              موظف خدمات — الراتب كامل من مصاريف العيادة.
            </p>
          )}

          <p className="text-xs text-slate-400">
            {person.category === "assistant"
              ? "يُحدَّث تلقائياً في سجلات الرواتب غير المُصرفة لهذا المساعد (من أي صفحة تعدّل منها)."
              : person.category === "doctor_salary"
                ? "يُحدَّث تلقائياً في قسائم الراتب غير المُصرفة — يظهر أيضاً عند تعديل الطبيب من صفحة الأطباء."
                : "يُحدَّث تلقائياً في قسائم الراتب غير المُسلَّمة لموظفي العيادة."}
          </p>

          {error && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          )}

          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50"
            >
              إلغاء
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-white hover:bg-primary/90 disabled:opacity-60"
            >
              {saving && <RefreshCw className="h-4 w-4 animate-spin" />}
              حفظ
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
