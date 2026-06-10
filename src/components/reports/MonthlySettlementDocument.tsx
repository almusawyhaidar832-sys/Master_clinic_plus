"use client";

import { ClinicBrandingHeader } from "@/components/branding/ClinicBrandingHeader";
import { formatDoctorDisplayName } from "@/lib/services/clinic-profile";
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
                {doc.specialty && (
                  <span className="text-xs text-slate-muted">{doc.specialty}</span>
                )}
              </div>
              <div className="space-y-1 text-sm">
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
