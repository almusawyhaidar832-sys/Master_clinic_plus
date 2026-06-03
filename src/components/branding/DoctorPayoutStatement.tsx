"use client";

import type { ClinicProfile } from "@/types/clinic-profile";
import type { Doctor } from "@/types";
import { ClinicBrandingHeader } from "./ClinicBrandingHeader";
import { formatDoctorDisplayName } from "@/lib/services/clinic-profile";
import { formatCurrency, formatDate } from "@/lib/utils";

interface DoctorPayoutStatementProps {
  clinic: ClinicProfile | null;
  doctor: Doctor;
  summary: {
    totalEarned: number;
    totalWithdrawn: number;
    withdrawableBalance: number;
    pendingWithdrawalAmount: number;
  };
  operations: {
    id: string;
    operation_date?: string;
    operation_type?: string;
    operation_name_ar?: string;
    doctor_share_amount?: number;
    patient?: { full_name_ar: string };
  }[];
  withdrawals: {
    id: string;
    amount: number;
    status: string;
    requested_at: string;
  }[];
}

export function DoctorPayoutStatement({
  clinic,
  doctor,
  summary,
  operations,
  withdrawals,
}: DoctorPayoutStatementProps) {
  return (
    <div
      id="doctor-payout-statement-print"
      className="rounded-xl border border-slate-border bg-white p-4 text-slate-text sm:p-6"
    >
      <ClinicBrandingHeader
        profile={clinic}
        title="كشف حساب طبيب — مستحقات وسحوبات"
        subtitle={formatDoctorDisplayName(doctor.full_name_ar)}
        meta={`التخصص: ${doctor.specialty_ar || "—"} — نسبة ${doctor.percentage}%`}
        size="lg"
      />

      <div className="mb-6 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
        <div className="rounded-lg bg-surface p-2 text-center">
          <p className="text-xs text-slate-muted">إجمالي المستحق</p>
          <p className="font-bold">{formatCurrency(summary.totalEarned)}</p>
        </div>
        <div className="rounded-lg bg-surface p-2 text-center">
          <p className="text-xs text-slate-muted">المسحوب</p>
          <p className="font-bold">{formatCurrency(summary.totalWithdrawn)}</p>
        </div>
        <div className="rounded-lg bg-primary/10 p-2 text-center">
          <p className="text-xs text-slate-muted">قابل للسحب</p>
          <p className="font-bold text-primary">
            {formatCurrency(summary.withdrawableBalance)}
          </p>
        </div>
        <div className="rounded-lg bg-amber-50 p-2 text-center">
          <p className="text-xs text-slate-muted">سحب معلّق</p>
          <p className="font-bold text-amber-700">
            {formatCurrency(summary.pendingWithdrawalAmount)}
          </p>
        </div>
      </div>

      <section className="mb-6">
        <h3 className="mb-2 text-sm font-bold">
          عمليات {formatDoctorDisplayName(doctor.full_name_ar)}
        </h3>
        <table className="w-full text-xs sm:text-sm">
          <thead>
            <tr className="border-b text-right text-slate-muted">
              <th className="py-1">التاريخ</th>
              <th className="py-1">المريض</th>
              <th className="py-1">العملية</th>
              <th className="py-1">حصة الطبيب</th>
            </tr>
          </thead>
          <tbody>
            {operations.map((op) => (
              <tr key={op.id} className="border-b border-slate-border/40">
                <td className="py-1">{formatDate(op.operation_date ?? "")}</td>
                <td className="py-1">
                  {(op.patient as { full_name_ar: string })?.full_name_ar ?? "—"}
                </td>
                <td className="py-1">{op.operation_type || op.operation_name_ar || "—"}</td>
                <td className="py-1 font-medium text-primary">
                  {formatCurrency(op.doctor_share_amount ?? 0)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {withdrawals.length > 0 && (
        <section>
          <h3 className="mb-2 text-sm font-bold">طلبات السحب</h3>
          <table className="w-full text-xs sm:text-sm">
            <thead>
              <tr className="border-b text-right text-slate-muted">
                <th className="py-1">التاريخ</th>
                <th className="py-1">المبلغ</th>
                <th className="py-1">الحالة</th>
              </tr>
            </thead>
            <tbody>
              {withdrawals.map((w) => (
                <tr key={w.id} className="border-b border-slate-border/40">
                  <td className="py-1">{formatDate(w.requested_at)}</td>
                  <td className="py-1">{formatCurrency(w.amount)}</td>
                  <td className="py-1">{w.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
