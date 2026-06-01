"use client";

import { useMemo } from "react";
import { calculateDoctorShare } from "@/lib/finance";
import { formatCurrency } from "@/lib/utils";
import type { Doctor, DoctorPercentage, MaterialsCostShare } from "@/types";

interface FinancialPreviewProps {
  totalAmount: number;
  materialsCost: number;
  doctor: Doctor | null;
  reviewFee?: number;
  className?: string;
}

export function FinancialPreview({
  totalAmount,
  materialsCost,
  doctor,
  reviewFee = 0,
  className = "",
}: FinancialPreviewProps) {
  const preview = useMemo(() => {
    if (!doctor || totalAmount <= 0) return null;

    const grossTotal = totalAmount + reviewFee;
    const { doctorShare, clinicShare } = calculateDoctorShare(
      grossTotal,
      doctor.percentage as DoctorPercentage,
      materialsCost,
      doctor.materials_share as MaterialsCostShare
    );

    const pct = Number(doctor.percentage);
    const matPct = Number(doctor.materials_share);
    const doctorGross = grossTotal * (pct / 100);
    const doctorMaterials = materialsCost * (matPct / 100);
    const clinicMaterials = materialsCost - doctorMaterials;

    return {
      grossTotal,
      doctorGross,
      doctorMaterials,
      clinicMaterials,
      doctorShare,
      clinicShare,
    };
  }, [totalAmount, materialsCost, doctor, reviewFee]);

  if (!preview) {
    return (
      <div
        className={`rounded-xl border border-dashed border-slate-border bg-surface p-4 text-sm text-slate-muted ${className}`}
      >
        اختر الطبيب وأدخل المبلغ لمعاينة التوزيع المالي مباشرة
      </div>
    );
  }

  return (
    <div
      className={`grid gap-3 rounded-xl border border-primary/20 bg-gradient-to-br from-primary/5 to-surface p-4 sm:grid-cols-2 ${className}`}
    >
      <div className="space-y-2">
        <p className="text-xs font-semibold text-primary">حصة الطبيب</p>
        <div className="space-y-1 text-sm">
          <div className="flex justify-between">
            <span className="text-slate-muted">إجمالي العملية</span>
            <span className="font-medium">{formatCurrency(preview.grossTotal)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-muted">حصة أولية ({doctor?.percentage}%)</span>
            <span>{formatCurrency(preview.doctorGross)}</span>
          </div>
          <div className="flex justify-between text-amber-700">
            <span>تحمل المواد (طبيب)</span>
            <span>−{formatCurrency(preview.doctorMaterials)}</span>
          </div>
          <div className="flex justify-between border-t border-primary/20 pt-2 font-bold text-primary">
            <span>صافي الطبيب → المحفظة</span>
            <span>{formatCurrency(preview.doctorShare)}</span>
          </div>
        </div>
      </div>
      <div className="space-y-2">
        <p className="text-xs font-semibold text-slate-text">حصة العيادة</p>
        <div className="space-y-1 text-sm">
          <div className="flex justify-between text-amber-700">
            <span>تحمل المواد (عيادة)</span>
            <span>{formatCurrency(preview.clinicMaterials)}</span>
          </div>
          <div className="flex justify-between border-t border-slate-border pt-2 font-bold text-slate-text">
            <span>صافي العيادة</span>
            <span>{formatCurrency(preview.clinicShare)}</span>
          </div>
          <p className="text-[10px] text-slate-muted leading-relaxed">
            سحوبات الأطباء لا تُخصم من ربح العيادة — تُخصم فقط من محفظة الطبيب
          </p>
        </div>
      </div>
    </div>
  );
}
