"use client";

import { Pencil, UserX } from "lucide-react";
import { Select } from "@/components/ui/Select";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { CurrencyInput } from "@/components/ui/CurrencyInput";
import { breakdownAssistantSalary } from "@/lib/services/assistant-payroll";
import type { PayrollPerson } from "@/lib/services/payroll-persons";
import { formatCurrency } from "@/lib/utils";

interface EmployeePayrollProfileCardProps {
  options: { value: string; label: string }[];
  selectedKey: string;
  onSelect: (key: string) => void;
  person: PayrollPerson | null;
  totalCount: number;
  onEditSalary?: () => void;
  onDeactivate?: () => void;
}

export function EmployeePayrollProfileCard({
  options,
  selectedKey,
  onSelect,
  person,
  totalCount,
  onEditSalary,
  onDeactivate,
}: EmployeePayrollProfileCardProps) {
  const assistantBreakdown =
    person?.category === "assistant"
      ? breakdownAssistantSalary({
          total_salary: person.base_salary,
          doctor_share_percentage: person.doctor_share_percentage ?? 0,
        })
      : null;

  return (
    <div className="rounded-xl border border-primary/20 bg-gradient-to-b from-primary/5 to-white p-5 shadow-sm">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-lg font-bold text-slate-text">اختيار الموظف</h3>
          <p className="text-xs text-slate-muted">
            قائمة شاملة — مساعدو الأطباء + موظفو الخدمات ({totalCount} نشط)
          </p>
        </div>
        {person && onEditSalary && (
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" onClick={onEditSalary}>
              <Pencil className="h-3.5 w-3.5" />
              تعديل الراتب
            </Button>
            {onDeactivate && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={onDeactivate}
                className="border-amber-300 text-amber-800 hover:bg-amber-50"
              >
                <UserX className="h-3.5 w-3.5" />
                إيقاف الموظف
              </Button>
            )}
          </div>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Select
          label="جميع العاملين بالعيادة"
          value={selectedKey}
          onChange={(e) => onSelect(e.target.value)}
          options={options}
          placeholder={options.length === 0 ? "لا يوجد عاملون نشطون — أضف موظفاً أولاً" : undefined}
          required={options.length > 0}
        />

        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            label="الوظيفة"
            value={person?.job_title_ar ?? ""}
            readOnly
            disabled
            placeholder="—"
            className="bg-slate-50"
          />
          <CurrencyInput
            label="الراتب الأساسي"
            value={person != null ? String(person.base_salary) : ""}
            onChange={() => {}}
            readOnly
            disabled
            placeholder="—"
          />
        </div>
      </div>

      {options.length === 0 ? (
        <p className="mt-4 rounded-lg border border-dashed border-amber-300 bg-amber-50 px-4 py-3 text-center text-sm text-amber-900">
          لا يوجد عاملون في القائمة — أضف موظفاً من النموذج أدناه ثم سيظهر هنا تلقائياً
        </p>
      ) : !person ? (
        <p className="mt-4 rounded-lg border border-dashed border-slate-border px-4 py-3 text-center text-sm text-slate-muted">
          اختر موظفاً من القائمة — يُملأ الراتب والوظيفة تلقائياً من قاعدة البيانات
        </p>
      ) : person.category === "accountant" ? (
        <div className="mt-4 rounded-lg border border-violet-200 bg-violet-50/80 p-4 text-sm">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-violet-600 px-2.5 py-0.5 text-xs font-bold text-white">
              محاسب
            </span>
            <span className="text-slate-600">{person.role}</span>
          </div>
          <p className="font-medium text-primary">
            مصروف عيادة كامل: {formatCurrency(person.base_salary)}
          </p>
          <p className="mt-1 text-xs text-violet-800">
            راتب المحاسب يُعدّل من إدارة الرواتب — يظهر في صرف الرواتب الشهرية.
          </p>
        </div>
      ) : person.category === "doctor_salary" ? (
        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50/80 p-4 text-sm">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-amber-600 px-2.5 py-0.5 text-xs font-bold text-white">
              طبيب — راتب ثابت
            </span>
            <span className="text-slate-600">{person.role}</span>
          </div>
          <p className="font-medium text-primary">
            الراتب الشهري: {formatCurrency(person.base_salary)}
          </p>
          <p className="mt-1 text-xs text-amber-900">
            سجّل سلفة أو خصماً أو مكافأة من النموذج أدناه — الصرف من مصاريف
            العيادة.
          </p>
        </div>
      ) : person.category === "assistant" ? (
        <div className="mt-4 rounded-lg border border-teal-200 bg-teal-50/80 p-4 text-sm">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-teal-600 px-2.5 py-0.5 text-xs font-bold text-white">
              مساعد طبيب
            </span>
            <span className="text-slate-600">{person.role}</span>
          </div>
          {assistantBreakdown && (
            <div className="grid gap-1 text-slate-700 sm:grid-cols-3">
              <span>
                الراتب الكلي:{" "}
                <strong>{formatCurrency(assistantBreakdown.totalSalary)}</strong>
              </span>
              <span className="text-primary">
                حصة العيادة:{" "}
                <strong>{formatCurrency(assistantBreakdown.clinicShare)}</strong>
              </span>
              <span className="text-amber-800">
                حصة الطبيب ({assistantBreakdown.doctorSharePercentage}%):{" "}
                <strong>{formatCurrency(assistantBreakdown.doctorShare)}</strong>
              </span>
            </div>
          )}
          <p className="mt-2 text-xs text-teal-800">
            يُقسّم الراتب عند «توليد رواتب الشهر» — يُخصم من حساب الطبيب المرتبط.
          </p>
        </div>
      ) : (
        <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-slate-600 px-2.5 py-0.5 text-xs font-bold text-white">
              موظف خدمات / منظف
            </span>
            <span className="text-slate-600">{person.role}</span>
          </div>
          <p className="font-medium text-primary">
            مصروف عيادة كامل: {formatCurrency(person.base_salary)}
          </p>
          <p className="mt-1 text-xs text-slate-muted">
            لا يُربط بأي طبيب — لا خصم من حسابات الأطباء.
          </p>
        </div>
      )}
    </div>
  );
}
