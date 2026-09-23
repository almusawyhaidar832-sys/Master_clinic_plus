"use client";

import { Input } from "@/components/ui/Input";
import {
  DOCTOR_PAYMENT_TYPE_OPTIONS,
  materialsShareHint,
} from "@/lib/constants";
import type { DoctorPaymentType } from "@/types";
import { cn } from "@/lib/utils";
import { Wallet } from "lucide-react";

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
    <div className="space-y-4 rounded-2xl border border-slate-border bg-surface p-4">
      <div>
        <p className="mb-2.5 flex items-center gap-2 text-sm font-bold text-slate-text">
          <Wallet className="h-4 w-4 text-premium-500" />
          الاتفاق المالي (financial_agreement)
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          {DOCTOR_PAYMENT_TYPE_OPTIONS.map((opt) => (
            <label
              key={opt.value}
              className={cn(
                "flex cursor-pointer items-center gap-2.5 rounded-xl border px-3.5 py-2.5 text-sm font-semibold transition-all",
                paymentType === opt.value
                  ? "border-primary-300 bg-primary-50 text-primary-800 shadow-card ring-1 ring-inset ring-primary-200"
                  : "border-slate-border bg-surface-card text-slate-muted hover:border-premium-300 hover:text-slate-text"
              )}
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

      <p className="rounded-xl border border-slate-border bg-surface-card px-3 py-2 text-xs leading-relaxed text-slate-muted">
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
              <p className="mt-1 text-xs text-slate-muted">{labHint}</p>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
