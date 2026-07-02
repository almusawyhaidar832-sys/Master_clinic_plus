"use client";

import { useMemo } from "react";
import { isSalaryDoctor } from "@/lib/services/doctor-payment";
import { previewPaidSessionSplit } from "@/lib/services/patient-financial-plan";
import { splitTreatmentAndReviewFee } from "@/lib/finance";
import type { Doctor, DoctorPercentage, MaterialsCostShare } from "@/types";
import { formatCurrency } from "@/lib/utils";

interface FinancialPreviewProps {
  totalAmount: number;
  materialsCost: number;
  doctor: Doctor | null;
  reviewFee?: number;
  className?: string;
  lockedSplit?: { doctorShare: number; clinicShare: number; agreedTotal: number };
  isPaymentSession?: boolean;
  paidAmount?: number;
  caseFinalPrice?: number;
  caseDoctorShareTotal?: number;
  caseClinicShareTotal?: number;
}

type SplitPreview = {
  grossTotal: number;
  doctorGross: number;
  doctorMaterials: number;
  clinicMaterials: number;
  doctorShare: number;
  clinicShare: number;
  locked: boolean;
  salaryDoctor?: boolean;
};

function SplitColumns({
  preview,
  doctor,
  totalAmount,
  reviewFee,
}: {
  preview: SplitPreview;
  doctor: Doctor | null;
  totalAmount: number;
  reviewFee: number;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="rounded-lg border border-primary/15 bg-white/80 p-3 space-y-2">
        <p className="text-xs font-bold text-primary">حصة الطبيب</p>
        <div className="space-y-1 text-sm">
          <div className="flex justify-between gap-2">
            <span className="text-slate-muted">إجمالي العملية</span>
            <span className="font-semibold tabular-nums">
              {formatCurrency(preview.grossTotal)}
            </span>
          </div>
          {reviewFee > 0 && (
            <>
              <div className="flex justify-between gap-2 text-slate-muted">
                <span>سعر العلاج (يُقسّم)</span>
                <span className="tabular-nums">{formatCurrency(totalAmount)}</span>
              </div>
              <div className="flex justify-between gap-2 text-teal-800">
                <span>كشفية مراجع (للعيادة فقط)</span>
                <span className="tabular-nums">+{formatCurrency(reviewFee)}</span>
              </div>
            </>
          )}
          {!preview.salaryDoctor && (
            <div className="flex justify-between gap-2">
              <span className="text-slate-muted">
                حصة أولية ({doctor?.percentage}%)
              </span>
              <span className="tabular-nums">{formatCurrency(preview.doctorGross)}</span>
            </div>
          )}
          <div className="flex justify-between gap-2 text-amber-700">
            <span>تحمل المواد (طبيب)</span>
            <span className="tabular-nums">−{formatCurrency(preview.doctorMaterials)}</span>
          </div>
          <div className="flex justify-between gap-2 border-t border-primary/20 pt-2 font-bold text-primary">
            <span>صافي الطبيب → المحفظة</span>
            <span className="tabular-nums">{formatCurrency(preview.doctorShare)}</span>
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white/80 p-3 space-y-2">
        <p className="text-xs font-bold text-slate-text">حصة العيادة</p>
        <div className="space-y-1 text-sm">
          <div className="flex justify-between gap-2 text-amber-700">
            <span>تحمل المواد (عيادة)</span>
            <span className="tabular-nums">{formatCurrency(preview.clinicMaterials)}</span>
          </div>
          <div className="flex justify-between gap-2 border-t border-slate-border pt-2 font-bold text-slate-text">
            <span>صافي العيادة</span>
            <span className="tabular-nums">{formatCurrency(preview.clinicShare)}</span>
          </div>
          <p className="text-[10px] text-slate-muted leading-relaxed">
            سحوبات الأطباء لا تُخصم من ربح العيادة — تُخصم فقط من محفظة الطبيب
          </p>
        </div>
      </div>
    </div>
  );
}

function PaidSplitColumns({
  paidPreview,
  doctor,
}: {
  paidPreview: { doctorShare: number; clinicShare: number; paidAmount: number };
  doctor: Doctor | null;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="rounded-lg border border-emerald-300/60 bg-emerald-50/60 p-3 space-y-2">
        <p className="text-xs font-bold text-emerald-800">من المبلغ المدفوع → الطبيب</p>
        <div className="space-y-1 text-sm">
          <div className="flex justify-between gap-2">
            <span className="text-slate-600">المبلغ المدفوع</span>
            <span className="font-semibold tabular-nums text-emerald-900">
              {formatCurrency(paidPreview.paidAmount)}
            </span>
          </div>
          {doctor && !isSalaryDoctor(doctor) && (
            <div className="flex justify-between gap-2 text-slate-muted">
              <span>نسبة من الدفعة</span>
              <span className="tabular-nums">
                {paidPreview.paidAmount > 0
                  ? `${Math.round((paidPreview.doctorShare / paidPreview.paidAmount) * 100)}%`
                  : "—"}
              </span>
            </div>
          )}
          <div className="flex justify-between gap-2 border-t border-emerald-300/50 pt-2 font-bold text-emerald-800">
            <span>يُضاف للمحفظة</span>
            <span className="tabular-nums">{formatCurrency(paidPreview.doctorShare)}</span>
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-slate-200 bg-slate-50/80 p-3 space-y-2">
        <p className="text-xs font-bold text-slate-800">من المبلغ المدفوع → العيادة</p>
        <div className="space-y-1 text-sm">
          <div className="flex justify-between gap-2">
            <span className="text-slate-600">المبلغ المدفوع</span>
            <span className="font-semibold tabular-nums">
              {formatCurrency(paidPreview.paidAmount)}
            </span>
          </div>
          <div className="flex justify-between gap-2 text-slate-muted">
            <span>نسبة من الدفعة</span>
            <span className="tabular-nums">
              {paidPreview.paidAmount > 0
                ? `${Math.round((paidPreview.clinicShare / paidPreview.paidAmount) * 100)}%`
                : "—"}
            </span>
          </div>
          <div className="flex justify-between gap-2 border-t border-slate-200 pt-2 font-bold text-slate-800">
            <span>صافي العيادة</span>
            <span className="tabular-nums">{formatCurrency(paidPreview.clinicShare)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export function FinancialPreview({
  totalAmount,
  materialsCost,
  doctor,
  reviewFee = 0,
  className = "",
  lockedSplit,
  isPaymentSession = false,
  paidAmount = 0,
  caseFinalPrice = 0,
  caseDoctorShareTotal = 0,
  caseClinicShareTotal = 0,
}: FinancialPreviewProps) {
  const preview = useMemo((): SplitPreview | null => {
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
      doctorGross,
      doctorMaterials,
      clinicMaterials,
      doctorShare: split.doctorShare,
      clinicShare: split.clinicShare,
      locked: false,
    };
  }, [totalAmount, materialsCost, doctor, reviewFee, lockedSplit]);

  const paidPreview = useMemo(() => {
    if (!doctor || paidAmount <= 0) return null;
    const caseDoc =
      caseDoctorShareTotal > 0
        ? caseDoctorShareTotal
        : (preview?.doctorShare ?? lockedSplit?.doctorShare ?? 0);
    const caseClinic =
      caseClinicShareTotal > 0
        ? caseClinicShareTotal
        : (preview?.clinicShare ?? lockedSplit?.clinicShare ?? 0);
    const finalPrice =
      caseFinalPrice > 0
        ? caseFinalPrice
        : (lockedSplit?.agreedTotal ?? preview?.grossTotal ?? 0);

    return previewPaidSessionSplit({
      paidAmount,
      caseFinalPrice: finalPrice,
      caseDoctorShare: caseDoc,
      caseClinicShare: caseClinic,
      doctor,
    });
  }, [
    doctor,
    paidAmount,
    caseFinalPrice,
    caseDoctorShareTotal,
    caseClinicShareTotal,
    preview,
    lockedSplit,
  ]);

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
    <div className={`space-y-3 ${className}`}>
      <div className="rounded-xl border border-primary/20 bg-gradient-to-br from-primary/5 to-surface p-3.5 space-y-3">
        <div>
          <p className="text-sm font-bold text-primary-800">
            ١ — توزيع السعر النهائي للحالة
          </p>
          <p className="text-xs text-slate-muted mt-0.5">
            يُحسب مرة واحدة على كامل الحالة ({formatCurrency(preview.grossTotal)})
          </p>
        </div>

        {preview.locked && (
          <p className="text-xs font-medium text-amber-800 bg-amber-50 rounded-lg px-3 py-2 border border-amber-200/80">
            جلسة الدفع لا تعيد حساب حصص السعر الكلي — تُوزَّع الدفعات فقط حسب النسب
            أدناه
          </p>
        )}

        <SplitColumns
          preview={preview}
          doctor={doctor}
          totalAmount={totalAmount}
          reviewFee={reviewFee}
        />
      </div>

      {paidPreview ? (
        <div className="rounded-xl border border-emerald-400/40 bg-gradient-to-br from-emerald-50/80 to-white p-3.5 space-y-3">
          <div>
            <p className="text-sm font-bold text-emerald-900">
              ٢ — توزيع المبلغ المدفوع في هذه الجلسة
            </p>
            <p className="text-xs text-emerald-800/80 mt-0.5">
              من {formatCurrency(paidPreview.paidAmount)} المدفوع اليوم — يُضاف للمحفظة
              والعيادة حسب نفس نسب الحالة
            </p>
          </div>
          <PaidSplitColumns paidPreview={paidPreview} doctor={doctor} />
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50/50 px-3 py-2.5 text-xs text-slate-muted">
          أدخل المبلغ المدفوع لمعاينة توزيعه بين الطبيب والعيادة
        </div>
      )}
    </div>
  );
}
