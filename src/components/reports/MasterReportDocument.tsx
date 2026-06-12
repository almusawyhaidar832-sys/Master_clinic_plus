"use client";

import type { MasterClinicReport } from "@/lib/services/clinic-reports";
import { ClinicBrandingHeader } from "@/components/branding/ClinicBrandingHeader";
import { withdrawalStatusLabel } from "@/lib/withdrawals/display";
import { formatCurrency, formatDate } from "@/lib/utils";

interface MasterReportDocumentProps {
  report: MasterClinicReport;
  title?: string;
  subtitle?: string;
}

export function MasterReportDocument({
  report,
  title = "التقرير المالي الشامل للعيادة",
  subtitle = "Master Clinic Plus",
}: MasterReportDocumentProps) {
  const { summary } = report;

  return (
    <div
      id="master-clinic-report-print"
      dir="rtl"
      className="rounded-xl border border-slate-border bg-white p-4 text-slate-text sm:p-6"
    >
      <ClinicBrandingHeader
        profile={report.clinicProfile}
        title={title}
        subtitle={subtitle}
        meta={`${report.periodLabel} — صادر في ${formatDate(report.generatedAt)}`}
        size="lg"
        className="mb-6"
      />

      <section className="mb-6">
        <h3 className="mb-3 text-sm font-bold text-primary">الملخص المالي الرئيسي</h3>
        <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
          <StatBox label="إجمالي الإيرادات (الشهر)" value={summary.totalRevenue} />
          <StatBox label="المرتجعات (مطروحة)" value={summary.totalRefunds} negative />
          <StatBox label="مصروفات عامة" value={summary.generalExpenses} negative />
          <StatBox label="رواتب الموظفين" value={summary.staffSalaries} negative />
          <StatBox label="محصّل الفترة" value={summary.cashInflow} />
          <StatBox label="حصة العيادة" value={summary.totalClinicShare} />
          <StatBox label="مستحقات الأطباء" value={summary.doctorPayouts} negative />
          <StatBox label="ديون معلّقة" value={summary.outstandingDebts} warning />
          <StatBox
            label="صافي ربح العيادة"
            value={summary.netProfit}
            highlight
            className="col-span-2 sm:col-span-1"
          />
        </div>
        <p className="mt-2 text-xs text-slate-muted">
          الربح الصافي = الإيرادات − المرتجعات − المصروفات − الرواتب
        </p>
      </section>

      <section
        className={`mb-6 grid gap-3 text-sm ${
          report.isCurrentMonthReport ? "grid-cols-2" : "grid-cols-1"
        }`}
      >
        {report.isCurrentMonthReport ? (
          <div className="rounded-lg bg-surface p-3">
            <p className="mb-1 font-semibold text-slate-text">
              {report.today.label}
            </p>
            <p>عمليات: {report.today.operationsCount}</p>
            <p>محصّل: {formatCurrency(report.today.totalCollected)}</p>
            <p className="text-debt-text">
              متبقي: {formatCurrency(report.today.totalRemainingDebt)}
            </p>
          </div>
        ) : null}
        <div className="rounded-lg bg-surface p-3">
          <p className="mb-1 font-semibold text-slate-text">
            {report.periodLabel}
          </p>
          <p>عمليات: {report.month.operationsCount}</p>
          <p>محصّل: {formatCurrency(report.month.totalCollected)}</p>
          <p className="text-debt-text">
            متبقي: {formatCurrency(report.month.totalRemainingDebt)}
          </p>
        </div>
      </section>

      {report.isCurrentMonthReport && report.pendingWithdrawals.length > 0 && (
        <section className="mb-6">
          <h3 className="mb-2 text-sm font-bold">طلبات سحب معلّقة</h3>
          <table className="w-full text-xs sm:text-sm">
            <thead>
              <tr className="border-b text-right text-slate-muted">
                <th className="py-1">الطبيب</th>
                <th className="py-1">المبلغ</th>
                <th className="py-1">التاريخ</th>
              </tr>
            </thead>
            <tbody>
              {report.pendingWithdrawals.map((w) => (
                <tr key={w.id} className="border-b border-slate-border/40">
                  <td className="py-1">{w.doctorName}</td>
                  <td className="py-1 font-medium text-amber-700">
                    {formatCurrency(w.amount)}
                  </td>
                  <td className="py-1">{formatDate(w.requested_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {report.monthWithdrawals.length > 0 && (
        <section className="mb-6">
          <h3 className="mb-2 text-sm font-bold">
            سحوبات الأطباء (الشهر)
          </h3>
          <table className="w-full text-xs sm:text-sm">
            <thead>
              <tr className="border-b text-right text-slate-muted">
                <th className="py-1">الطبيب</th>
                <th className="py-1">النوع</th>
                <th className="py-1">الحالة</th>
                <th className="py-1">المبلغ</th>
                <th className="py-1">التاريخ</th>
              </tr>
            </thead>
            <tbody>
              {report.monthWithdrawals.map((w) => (
                <tr key={w.id} className="border-b border-slate-border/40">
                  <td className="py-1">{w.doctorName}</td>
                  <td className="py-1 text-slate-muted">{w.source}</td>
                  <td className="py-1">{withdrawalStatusLabel(w.status)}</td>
                  <td className="py-1">{formatCurrency(w.amount)}</td>
                  <td className="py-1">{formatDate(w.effectiveDate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <section className="mb-6">
        <h3 className="mb-2 text-sm font-bold">
          حسابات الأطباء ({report.periodLabel})
        </h3>
        {report.doctors.length === 0 ? (
          <p className="text-sm text-slate-muted">
            لا توجد حركات أطباء مسجّلة في هذه الفترة
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[480px] text-xs sm:text-sm">
              <thead>
                <tr className="border-b text-right text-slate-muted">
                  <th className="py-1">الطبيب</th>
                  <th className="py-1">طريقة المحاسبة</th>
                  <th className="py-1">مستحق الشهر</th>
                  <th className="py-1">مسحوب الشهر</th>
                  {report.isCurrentMonthReport ? (
                    <>
                      <th className="py-1">قابل للسحب (حالي)</th>
                      <th className="py-1">سحب معلّق</th>
                    </>
                  ) : null}
                </tr>
              </thead>
              <tbody>
                {report.doctors.map((d) => (
                  <tr key={d.id} className="border-b border-slate-border/40">
                    <td className="py-1 font-medium">{d.full_name_ar}</td>
                    <td className="py-1 text-slate-muted">{d.paymentLabel}</td>
                    <td className="py-1">{formatCurrency(d.totalEarned)}</td>
                    <td className="py-1">
                      {formatCurrency(d.monthWithdrawn)}
                    </td>
                    {report.isCurrentMonthReport ? (
                      <>
                        <td className="py-1 text-primary">
                          {formatCurrency(d.withdrawableBalance)}
                        </td>
                        <td className="py-1 text-amber-700">
                          {d.pendingWithdrawalAmount > 0
                            ? formatCurrency(d.pendingWithdrawalAmount)
                            : "—"}
                        </td>
                      </>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {report.expenses.length > 0 && (
        <section className="mb-6">
          <h3 className="mb-2 text-sm font-bold">المصروفات العامة (الشهر)</h3>
          <table className="w-full text-xs sm:text-sm">
            <thead>
              <tr className="border-b text-right text-slate-muted">
                <th className="py-1">التاريخ</th>
                <th className="py-1">الوصف</th>
                <th className="py-1">المبلغ</th>
              </tr>
            </thead>
            <tbody>
              {report.expenses.map((e, i) => (
                <tr key={i} className="border-b border-slate-border/40">
                  <td className="py-1">{formatDate(e.expense_date)}</td>
                  <td className="py-1">{e.description_ar}</td>
                  <td className="py-1">{formatCurrency(e.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {report.salaryAdvances.length > 0 && (
        <section className="mb-6">
          <h3 className="mb-2 text-sm font-bold">
            سلف وخصومات ومكافآت الرواتب (الشهر)
          </h3>
          <table className="w-full text-xs sm:text-sm">
            <thead>
              <tr className="border-b text-right text-slate-muted">
                <th className="py-1">الاسم</th>
                <th className="py-1">الفئة</th>
                <th className="py-1">النوع</th>
                <th className="py-1">المبلغ</th>
                <th className="py-1">السبب</th>
                <th className="py-1">التاريخ</th>
              </tr>
            </thead>
            <tbody>
              {report.salaryAdvances.map((e, i) => (
                <tr key={i} className="border-b border-slate-border/40">
                  <td className="py-1">
                    {e.personName}
                    <span className="block text-[10px] text-slate-muted">
                      {e.jobTitle}
                    </span>
                  </td>
                  <td className="py-1 text-slate-muted">{e.personCategory}</td>
                  <td className="py-1">{e.entryType}</td>
                  <td className="py-1">{formatCurrency(e.amount)}</td>
                  <td className="py-1 text-slate-muted">{e.notes ?? "—"}</td>
                  <td className="py-1">{formatDate(e.entry_date)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {report.refunds.length > 0 && (
        <section className="mb-6">
          <h3 className="mb-2 text-sm font-bold">سجل المرتجعات</h3>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[480px] text-xs sm:text-sm">
              <thead>
                <tr className="border-b text-right text-slate-muted">
                  <th className="py-1">اسم المراجع</th>
                  <th className="py-1">المبلغ المسترجع</th>
                  <th className="py-1">الطبيب المتضرر</th>
                  <th className="py-1">التاريخ</th>
                </tr>
              </thead>
              <tbody>
                {report.refunds.map((r) => (
                  <tr key={r.id} className="border-b border-slate-border/40">
                    <td className="py-1 font-medium">{r.patientName}</td>
                    <td className="py-1 font-semibold text-amber-700">
                      {formatCurrency(r.amount)}
                    </td>
                    <td className="py-1 text-primary">{r.doctorName}</td>
                    <td className="py-1">{formatDate(r.date)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {report.monthOperations.length > 0 && (
        <section>
          <h3 className="mb-2 text-sm font-bold">
            عمليات الشهر ({report.monthOperations.length})
          </h3>
          <table className="w-full text-[10px] sm:text-xs">
            <thead>
              <tr className="border-b text-right text-slate-muted">
                <th className="py-1">التاريخ</th>
                <th className="py-1">المريض</th>
                <th className="py-1">الطبيب</th>
                <th className="py-1">العملية</th>
                <th className="py-1">المدفوع</th>
              </tr>
            </thead>
            <tbody>
              {report.monthOperations.slice(0, 50).map((op, i) => (
                <tr key={i} className="border-b border-slate-border/40">
                  <td className="py-0.5">{formatDate(op.operation_date ?? "")}</td>
                  <td className="py-0.5">{op.patientName}</td>
                  <td className="py-0.5 font-medium text-primary">
                    {op.doctorName}
                  </td>
                  <td className="py-0.5">{op.operation_type || op.operation_name_ar || "—"}</td>
                  <td className="py-0.5">{formatCurrency(op.paid_amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {report.monthOperations.length > 50 && (
            <p className="mt-2 text-xs text-slate-muted">
              يعرض أول 50 عملية من {report.monthOperations.length}
            </p>
          )}
        </section>
      )}

      <footer className="mt-8 border-t border-slate-border pt-4 text-center text-[10px] text-slate-muted">
        {report.clinicName} — تقرير سري وخاص بإدارة العيادة
      </footer>
    </div>
  );
}

function StatBox({
  label,
  value,
  negative,
  warning,
  highlight,
  className,
}: {
  label: string;
  value: number;
  negative?: boolean;
  warning?: boolean;
  highlight?: boolean;
  className?: string;
}) {
  return (
    <div
      className={`rounded-lg p-2 ${
        highlight
          ? "bg-primary/10 ring-1 ring-primary/30"
          : warning
            ? "bg-debt/30"
            : "bg-surface"
      } ${className ?? ""}`}
    >
      <p className="text-[10px] text-slate-muted sm:text-xs">{label}</p>
      <p
        className={`text-sm font-bold sm:text-base ${
          highlight
            ? "text-primary"
            : negative
              ? "text-debt-text"
              : warning
                ? "text-amber-700"
                : "text-slate-text"
        }`}
      >
        {formatCurrency(value)}
      </p>
    </div>
  );
}
