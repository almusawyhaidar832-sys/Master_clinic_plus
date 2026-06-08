"use client";

import type { ClinicProfile } from "@/types/clinic-profile";
import type { Doctor } from "@/types";
import { ClinicBrandingHeader } from "./ClinicBrandingHeader";
import { formatDoctorDisplayName } from "@/lib/services/clinic-profile";
import { doctorPaymentLabel, isSalaryDoctor } from "@/lib/services/doctor-payment";
import type { DoctorMonthlySettlement } from "@/lib/services/assistant-payroll";
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
  settlement?: DoctorMonthlySettlement | null;
}

export function DoctorPayoutStatement({
  clinic,
  doctor,
  summary,
  operations,
  withdrawals,
  settlement,
}: DoctorPayoutStatementProps) {
  return (
    <div
      id="doctor-payout-statement-print"
      className="rounded-xl border border-slate-border bg-white p-4 text-slate-text sm:p-6"
    >
      <ClinicBrandingHeader
        profile={clinic}
        title="كشف حساب طبيب — مستحقات وتصفية شهرية"
        subtitle={formatDoctorDisplayName(doctor.full_name_ar)}
        meta={`التخصص: ${doctor.specialty_ar || "—"} — ${doctorPaymentLabel(doctor)}`}
        size="lg"
      />

      {settlement && (
        <section className="mb-6 rounded-xl border border-primary/25 bg-primary/5 p-4">
          <h3 className="mb-3 text-sm font-bold text-primary">
            التقرير المالي الشهري — تصفية الحساب
          </h3>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between gap-4">
              <span className="text-slate-muted">إجمالي دخل الطبيب</span>
              <span className="font-semibold">
                {formatCurrency(settlement.totalDoctorIncome)}
              </span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-slate-muted">صرفيات العيادة (حصة الطبيب)</span>
              <span className="font-semibold text-debt-text">
                − {formatCurrency(settlement.totalClinicExpenses)}
              </span>
            </div>
            {settlement.assistantLines.length > 0 && (
              <div className="rounded-lg border border-amber-200 bg-amber-50/80 p-3">
                <p className="mb-2 text-xs font-bold text-amber-900">
                  خصم رواتب المساعدين (Payroll Deduction)
                </p>
                <ul className="space-y-1 text-xs">
                  {settlement.assistantLines.map((line) => (
                    <li
                      key={line.assistantId}
                      className="flex flex-wrap justify-between gap-2"
                    >
                      <span>
                        {line.assistantName} — راتب {formatCurrency(line.totalSalary)}{" "}
                        × {line.doctorSharePercentage}%
                      </span>
                      <span className="font-medium text-amber-800">
                        − {formatCurrency(line.doctorDeduction)}
                      </span>
                    </li>
                  ))}
                </ul>
                <div className="mt-2 flex justify-between border-t border-amber-200 pt-2 text-sm font-bold text-amber-900">
                  <span>إجمالي خصم رواتب المساعدين</span>
                  <span>− {formatCurrency(settlement.assistantPayrollDeduction)}</span>
                </div>
              </div>
            )}
            {settlement.expenseLines.length > 0 && (
              <details className="text-xs text-slate-muted">
                <summary className="cursor-pointer font-medium">
                  تفاصيل صرفيات العيادة ({settlement.expenseLines.length})
                </summary>
                <ul className="mt-2 space-y-1">
                  {settlement.expenseLines.map((e) => (
                    <li key={e.id} className="flex justify-between gap-2">
                      <span>
                        {formatDate(e.expenseDate)} — {e.description} (
                        {e.percentageSplit}%)
                      </span>
                      <span>− {formatCurrency(e.doctorShare)}</span>
                    </li>
                  ))}
                </ul>
              </details>
            )}
            <div className="flex justify-between gap-4 border-t border-primary/20 pt-3 text-base font-bold">
              <span>صافي ربح الطبيب (Doctor Net Profit)</span>
              <span className="text-primary">
                {formatCurrency(settlement.doctorNetProfit)}
              </span>
            </div>
            <p className="text-xs text-slate-muted" dir="ltr">
              = (Total Doctor Income − Clinic Expenses) − (Assistant Salary × Doctor
              Share %)
            </p>
          </div>
        </section>
      )}

      <div className="mb-6 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
        <div className="rounded-lg bg-surface p-2 text-center">
          <p className="text-xs text-slate-muted">
            {isSalaryDoctor(doctor) ? "الراتب الشهري" : "إجمالي المستحق"}
          </p>
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
          {isSalaryDoctor(doctor)
            ? `ملخص ${formatDoctorDisplayName(doctor.full_name_ar)} — راتب ثابت`
            : `عمليات ${formatDoctorDisplayName(doctor.full_name_ar)}`}
        </h3>
        {isSalaryDoctor(doctor) ? (
          <p className="rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-sm text-slate-text">
            هذا الطبيب على نظام <strong>راتب ثابت شهري</strong> بقيمة{" "}
            <strong>{formatCurrency(doctor.salary_amount ?? 0)}</strong> — لا
            تُحسب له حصة من الجلسات في التقرير الشهري.
          </p>
        ) : (
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
        )}
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
