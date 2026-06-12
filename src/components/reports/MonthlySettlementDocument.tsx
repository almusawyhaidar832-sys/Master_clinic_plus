"use client";

import { ClinicBrandingHeader } from "@/components/branding/ClinicBrandingHeader";
import { formatDoctorDisplayName } from "@/lib/services/clinic-profile";
import { isSalaryDoctor } from "@/lib/services/doctor-payment";
import { withdrawalStatusLabel } from "@/lib/withdrawals/display";
import type { MonthlySettlementReport } from "@/lib/services/clinic-reports";
import { formatCurrency, formatDate } from "@/lib/utils";

interface MonthlySettlementDocumentProps {
  report: MonthlySettlementReport;
}

export function MonthlySettlementDocument({
  report,
}: MonthlySettlementDocumentProps) {
  return (
    <div
      id="monthly-settlement-print"
      dir="rtl"
      className="rounded-xl border border-slate-border bg-white p-6 text-slate-text"
    >
      <ClinicBrandingHeader
        profile={report.clinicProfile}
        title="كشف التسوية الشهرية"
        subtitle={report.periodLabel}
        meta={`تاريخ الإصدار: ${formatDate(new Date(report.generatedAt))}`}
        size="lg"
        className="mb-6"
      />

      <section className="mb-6 rounded-xl border border-primary/25 bg-primary/5 p-4">
        <h3 className="mb-3 text-sm font-bold text-primary">ملخص العيادة</h3>
        <div className="grid gap-2 text-sm sm:grid-cols-2">
          <Row label="إجمالي دخل الأطباء" value={report.totals.totalDoctorIncome} />
          <Row
            label="صرفيات العيادة (حصة الأطباء)"
            value={-report.totals.totalClinicExpenses}
            negative
          />
          <Row
            label="خصم رواتب المساعدين"
            value={-report.totals.totalAssistantDeductions}
            negative
          />
          <Row
            label="صافي مستحقات الأطباء"
            value={report.totals.totalNetPayout}
            highlight
          />
          <Row
            label="إجمالي المسحوب (الشهر)"
            value={-report.totals.totalWithdrawn}
            negative
          />
          {report.isCurrentMonthReport ? (
            <Row
              label="إجمالي أرصدة الأطباء (كالتطبيق)"
              value={report.totals.totalRemaining}
              highlight
            />
          ) : null}
          <Row
            label="صافي ربح العيادة"
            value={report.totals.clinicNetProfit}
            highlight
            className="sm:col-span-2"
          />
        </div>
      </section>

      <h3 className="mb-3 text-base font-bold">تصفية الأطباء</h3>
      {report.doctors.length === 0 ? (
        <p className="text-sm text-slate-muted">لا توجد بيانات تسوية لهذا الشهر</p>
      ) : (
        <div className="space-y-4">
          {report.doctors.map((doc) => (
            <div
              key={doc.doctorId}
              className="rounded-lg border border-slate-border p-4"
            >
              <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                <p className="font-bold text-slate-text">
                  {formatDoctorDisplayName(doc.doctorName)}
                </p>
                <span className="text-xs text-slate-muted">
                  {[doc.specialty, doc.paymentLabel].filter(Boolean).join(" — ")}
                </span>
              </div>
              <div className="space-y-1 text-sm">
                {doc.settlement.salaryBaseAmount != null && (
                  <>
                    <Row
                      label="راتب أساسي"
                      value={doc.settlement.salaryBaseAmount}
                    />
                    {(doc.settlement.salaryAdvances ?? 0) > 0 && (
                      <Row
                        label="سلف"
                        value={-(doc.settlement.salaryAdvances ?? 0)}
                        negative
                      />
                    )}
                    {(doc.settlement.salaryDeductions ?? 0) > 0 && (
                      <Row
                        label="خصومات"
                        value={-(doc.settlement.salaryDeductions ?? 0)}
                        negative
                      />
                    )}
                    {(doc.settlement.salaryBonuses ?? 0) > 0 && (
                      <Row
                        label="مكافآت"
                        value={doc.settlement.salaryBonuses ?? 0}
                      />
                    )}
                  </>
                )}
                <Row label="دخل الطبيب" value={doc.settlement.totalDoctorIncome} />
                <Row
                  label="صرفيات العيادة"
                  value={-doc.settlement.totalClinicExpenses}
                  negative
                />
                {doc.settlement.assistantPayrollDeduction > 0 && (
                  <Row
                    label="خصم مساعدين"
                    value={-doc.settlement.assistantPayrollDeduction}
                    negative
                  />
                )}
                <Row
                  label="الصافي النهائي"
                  value={doc.settlement.doctorNetProfit}
                  highlight
                />
                {doc.monthWithdrawn > 0 ? (
                  <Row
                    label={
                      isSalaryDoctor({ payment_type: doc.payment_type })
                        ? "راتب مُصرف هذا الشهر"
                        : "مسحوب هذا الشهر"
                    }
                    value={-doc.monthWithdrawn}
                    negative
                  />
                ) : null}
                {report.isCurrentMonthReport &&
                doc.pendingWithdrawalAmount > 0 ? (
                  <Row
                    label="سحب معلّق"
                    value={-doc.pendingWithdrawalAmount}
                    negative
                  />
                ) : null}
                {report.isCurrentMonthReport ? (
                  <Row
                    label="الرصيد الحالي (كالتطبيق)"
                    value={doc.remainingBalance}
                    highlight={doc.remainingBalance > 0}
                  />
                ) : null}
              </div>
              {doc.settlement.assistantLines.length > 0 && (
                <ul className="mt-2 space-y-0.5 text-xs text-slate-muted">
                  {doc.settlement.assistantLines.map((line) => (
                    <li key={line.assistantId}>
                      {line.assistantName}: خصم {formatCurrency(line.doctorDeduction)}
                    </li>
                  ))}
                </ul>
              )}
              {doc.withdrawals.length > 0 && (
                <ul className="mt-3 space-y-1 border-t border-slate-border/60 pt-2 text-xs">
                  <li className="font-semibold text-slate-text">تفاصيل السحب:</li>
                  {doc.withdrawals.map((w) => (
                    <li
                      key={w.id}
                      className="flex flex-wrap justify-between gap-2 text-slate-muted"
                    >
                      <span>
                        {formatDate(w.effectiveDate)} — {w.source} —{" "}
                        {withdrawalStatusLabel(w.status)}
                      </span>
                      <span className="font-medium text-debt-text">
                        {formatCurrency(w.amount)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Row({
  label,
  value,
  negative,
  highlight,
  className,
}: {
  label: string;
  value: number;
  negative?: boolean;
  highlight?: boolean;
  className?: string;
}) {
  return (
    <div className={`flex justify-between gap-3 ${className ?? ""}`}>
      <span className="text-slate-muted">{label}</span>
      <span
        className={
          highlight
            ? "font-bold text-primary tabular-nums"
            : negative
              ? "font-semibold text-debt-text tabular-nums"
              : "font-semibold tabular-nums"
        }
      >
        {negative && value !== 0 ? "− " : ""}
        {formatCurrency(Math.abs(value))}
      </span>
    </div>
  );
}
