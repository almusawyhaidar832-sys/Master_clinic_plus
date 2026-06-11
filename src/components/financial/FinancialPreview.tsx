"use client";

import { useMemo } from "react";
import { isSalaryDoctor } from "@/lib/services/doctor-payment";
import { splitTreatmentAndReviewFee } from "@/lib/finance";
import type { DoctorPercentage, MaterialsCostShare } from "@/types";
import { formatCurrency } from "@/lib/utils";
import type { Doctor, DoctorPercentage, MaterialsCostShare } from "@/types";

interface FinancialPreviewProps {
  totalAmount: number;
  materialsCost: number;
  doctor: Doctor | null;
  reviewFee?: number;
  className?: string;
  /** When set, split was already calculated on the treatment total */
  lockedSplit?: { doctorShare: number; clinicShare: number; agreedTotal: number };
  isPaymentSession?: boolean;
}

export function FinancialPreview({
  totalAmount,
  materialsCost,
  doctor,
  reviewFee = 0,
  className = "",
  lockedSplit,
  isPaymentSession = false,
}: FinancialPreviewProps) {
  const preview = useMemo(() => {
    if (!doctor) return null;

    if (lockedSplit && lockedSplit.agreedTotal > 0) {
      const salary = isSalaryDoctor(doctor);
      const pct = salary ? 0 : Number(doctor.percentage);
      const matPct = salary ? 0 : Number(doctor.materials_share);
      const treatmentBase = Math.max(0, lockedSplit.agreedTotal - reviewFee);
      const doctorGross = treatmentBase * (pct / 100);
      const doctorMaterials = materialsCost * (matPct / 100);
      const clinicMaterials = materialsCost - doctorMaterials;

      let doctorShare = lockedSplit.doctorShare;
      let clinicShare = lockedSplit.clinicShare;
      if (doctorShare <= 0 && clinicShare <= 0) {
        const recomputed = splitTreatmentAndReviewFee(
          treatmentBase,
          reviewFee,
          materialsCost,
          {
            percentage: doctor.percentage as DoctorPercentage,
            materials_share: doctor.materials_share as MaterialsCostShare,
            payment_type: doctor.payment_type,
            financial_agreement: doctor.financial_agreement,
          }
        );
        if (recomputed) {
          doctorShare = recomputed.doctorShare;
          clinicShare = recomputed.clinicShare;
        }
      }

      return {
        grossTotal: lockedSplit.agreedTotal,
        doctorGross,
        doctorMaterials,
        clinicMaterials,
        doctorShare,
        clinicShare,
        locked: true,
        salaryDoctor: salary,
      };
    }

    if (totalAmount <= 0 && reviewFee <= 0) return null;

    const split = splitTreatmentAndReviewFee(
      totalAmount,
      reviewFee,
      materialsCost,
      {
        percentage: doctor.percentage as DoctorPercentage,
        materials_share: doctor.materials_share as MaterialsCostShare,
        payment_type: doctor.payment_type,
        financial_agreement: doctor.financial_agreement,
      }
    );
    if (!split) return null;

    const pct = Number(doctor.percentage);
    const matPct = Number(doctor.materials_share);
    const doctorGross = totalAmount * (pct / 100);
    const doctorMaterials = materialsCost * (matPct / 100);
    const clinicMaterials = materialsCost - doctorMaterials;

    return {
      grossTotal: split.agreedTotal,
      treatmentTotal: totalAmount,
      doctorGross,
      doctorMaterials,
      clinicMaterials,
      doctorShare: split.doctorShare,
      clinicShare: split.clinicShare,
      reviewFeeClinicOnly: reviewFee,
      locked: false,
    };
  }, [totalAmount, materialsCost, doctor, reviewFee, lockedSplit]);

  if (!preview) {
    return (
      <div
        className={`rounded-xl border border-dashed border-slate-border bg-surface p-4 text-sm text-slate-muted ${className}`}
      >
        {isPaymentSession
          ? "جلسة متابعة — حصة الطبيب والعيادة محسوبة مرة واحدة على السعر النهائي (لا تُعاد كل جلسة)"
          : "اختر الطبيب — التوزيع يُحسب مرة واحدة على (السعر الكلي − الخصم)"}
      </div>
    );
  }

  return (
    <div
      className={`grid gap-3 rounded-xl border border-primary/20 bg-gradient-to-br from-primary/5 to-surface p-4 sm:grid-cols-2 ${className}`}
    >
      {preview.locked && (
        <p className="sm:col-span-2 text-xs font-medium text-amber-800 bg-amber-50 rounded-lg px-3 py-2">
          التوزيع على السعر النهائي {formatCurrency(preview.grossTotal)} — جلسة الدفع لا تعيد حساب الحصص
        </p>
      )}
      <div className="space-y-2">
        <p className="text-xs font-semibold text-primary">حصة الطبيب</p>
        <div className="space-y-1 text-sm">
          <div className="flex justify-between">
            <span className="text-slate-muted">إجمالي العملية</span>
            <span className="font-medium">{formatCurrency(preview.grossTotal)}</span>
          </div>
          {reviewFee > 0 && (
            <>
              <div className="flex justify-between text-slate-muted">
                <span>سعر العلاج (يُقسّم)</span>
                <span>{formatCurrency(totalAmount)}</span>
              </div>
              <div className="flex justify-between text-teal-800">
                <span>كشفية مراجع (للعيادة فقط)</span>
                <span>+{formatCurrency(reviewFee)}</span>
              </div>
            </>
          )}
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
