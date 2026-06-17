"use client";

import { Input } from "@/components/ui/Input";
import {
  DOCTOR_PAYMENT_TYPE_OPTIONS,
  materialsShareHint,
} from "@/lib/constants";
import type { DoctorPaymentType } from "@/types";

interface DoctorPaymentFieldsProps {
  paymentType: DoctorPaymentType;
  onPaymentTypeChange: (value: DoctorPaymentType) => void;
  salaryAmount: string;
  onSalaryAmountChange: (value: string) => void;
  percentage: string;
  onPercentageChange: (value: string) => void;
  materialsShare: string;
  onMaterialsShareChange: (value: string) => void;
}

export function DoctorPaymentFields({
  paymentType,
  onPaymentTypeChange,
  salaryAmount,
  onSalaryAmountChange,
  percentage,
  onPercentageChange,
  materialsShare,
  onMaterialsShareChange,
}: DoctorPaymentFieldsProps) {
  const isSalary = paymentType === "salary";
  const labHint = materialsShareHint(materialsShare);

  return (
    <div className="space-y-4 rounded-xl border border-slate-border bg-surface/40 p-4">
      <div>
        <p className="mb-2 text-sm font-semibold text-slate-text">
          الاتفاق المالي (financial_agreement)
        </p>
        <div className="flex flex-wrap gap-4">
          {DOCTOR_PAYMENT_TYPE_OPTIONS.map((opt) => (
            <label
              key={opt.value}
              className="flex cursor-pointer items-center gap-2 text-sm text-slate-text"
            >
              <input
                type="radio"
                name="payment_type"
                value={opt.value}
                checked={paymentType === opt.value}
                onChange={() =>
                  onPaymentTypeChange(opt.value as DoctorPaymentType)
                }
                className="h-4 w-4 accent-primary"
              />
              {opt.label}
            </label>
          ))}
        </div>
      </div>

      <p className="text-xs text-slate-500">
        {isSalary
          ? "راتب ثابت: الجلسات تذهب للعيادة — صرف الراتب من مصروفات العيادة → راتب الطبيب."
          : "تعديل النسبة يُحدَّث تلقائياً في حالات العلاج النشطة غير المسددة. الحالات المكتملة والمدفوعة تبقى كما هي."}
      </p>

      {isSalary ? (
        <Input
          label="قيمة الراتب الثابت (شهري) *"
          type="number"
          min={0}
          step="1000"
          value={salaryAmount}
          onChange={(e) => onSalaryAmountChange(e.target.value)}
          placeholder="مثال: 1500000"
          required
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label="نسبة الطبيب من كل عملية (%)"
            name="percentage"
            type="number"
            min={0}
            max={100}
            step={1}
            value={percentage}
            onChange={(e) => onPercentageChange(e.target.value)}
            placeholder="0 – 100"
            required
          />
          <div>
            <Input
              label="نسبة تحمّل الطبيب لتكلفة المختبر (%)"
              name="materials_share"
              type="number"
              min={0}
              max={100}
              step={1}
              value={materialsShare}
              onChange={(e) => onMaterialsShareChange(e.target.value)}
              placeholder="0 – 100"
              required
            />
            {labHint ? (
              <p className="mt-1 text-xs text-slate-500">{labHint}</p>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
