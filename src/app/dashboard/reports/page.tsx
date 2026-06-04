"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { Card, CardHeader, CardTitle } from "@/components/ui/Card";
import { Alert } from "@/components/ui/Alert";
import { MasterReportDocument } from "@/components/reports/MasterReportDocument";
import { ReportActions } from "@/components/reports/ReportActions";
import { downloadClinicReportPdf } from "@/lib/reports/pdf-export";
import { formatCurrency } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import {
  fetchAccountantClinicReport,
  getReportPeriodOptions,
  type MasterClinicReport,
} from "@/lib/services/clinic-reports";
import { currentMonthYear } from "@/lib/utils";
import { FileText, Loader2, ClipboardList } from "lucide-react";

export default function AccountantReportsPage() {
  const [monthYear, setMonthYear] = useState(currentMonthYear());
  const [report, setReport] = useState<MasterClinicReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pdfLoading, setPdfLoading] = useState(false);

  const periodOptions = getReportPeriodOptions();

  async function generateReport() {
    setLoading(true);
    setError(null);
    try {
      const supabase = createClient();
      const data = await fetchAccountantClinicReport(supabase, monthYear);
      setReport(data);
    } catch {
      setError("تعذر تجميع التقرير. تحقق من الاتصال وقاعدة البيانات.");
    }
    setLoading(false);
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-slate-text">تقارير العيادة</h2>
        <p className="text-slate-muted">
          تقرير شامل للمالك — عمليات يومية وشهرية، مصروفات، سلف الموظفين،
          وأطباء
        </p>
      </div>

      <Card className="border-primary/20 bg-primary/5">
        <CardHeader>
          <div className="flex items-start gap-3">
            <div className="rounded-lg bg-primary/10 p-2">
              <ClipboardList className="h-6 w-6 text-primary" />
            </div>
            <div>
              <CardTitle>تقرير تسليم للمالك</CardTitle>
              <p className="mt-1 text-sm text-slate-muted">
                بنقرة واحدة يُجمّع كل إحصائيات العيادة المالية في تقرير
                جاهز للطباعة أو المشاركة مع صاحب العيادة.
              </p>
            </div>
          </div>
        </CardHeader>

        <div className="space-y-4">
          <Select
            label="الشهر"
            value={monthYear}
            onChange={(e) => {
              setMonthYear(e.target.value);
              setReport(null);
            }}
            options={periodOptions}
          />

          <Button
            className="w-full"
            size="lg"
            onClick={generateReport}
            disabled={loading}
          >
            {loading ? (
              <>
                <Loader2 className="h-5 w-5 animate-spin" />
                جاري تجميع التقرير الشامل...
              </>
            ) : (
              <>
                <FileText className="h-5 w-5" />
                إنشاء تقرير العيادة الكامل
              </>
            )}
          </Button>
        </div>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">يتضمن التقرير</CardTitle>
        </CardHeader>
        <ul className="list-inside list-disc space-y-1 text-sm text-slate-muted">
          <li>ملخص الإيرادات والمصروفات والرواتب ومستحقات الأطباء</li>
          <li>عمليات اليوم والشهر مع المقبوضات والديون</li>
          <li>قائمة المصروفات العامة للفترة</li>
          <li>تفاصيل سلف وخصومات الموظفين</li>
          <li>حسابات الأطباء وطلبات السحب المعلّقة</li>
          <li>سجل عمليات الشهر (حتى 50 عملية في الطباعة)</li>
        </ul>
      </Card>

      {error && <Alert variant="error">{error}</Alert>}

      {report && (
        <div className="space-y-4">
          <Alert variant="success">
            تم إنشاء التقرير — جاهز للتسليم لصاحب العيادة
          </Alert>
          <ReportActions
            shareTitle={`تقرير العيادة — ${report.clinicName} — ${report.periodLabel}`}
            pdfLoading={pdfLoading}
            onExportPdf={async () => {
              setPdfLoading(true);
              try {
                const s = report.summary;
                await downloadClinicReportPdf({
                  clinicName: report.clinicName,
                  periodLabel: report.periodLabel,
                  generatedAt: new Date().toLocaleString("ar-IQ"),
                  title: "تقرير العيادة الشامل",
                  rows: [
                    { label: "إجمالي الإيرادات", value: formatCurrency(s.totalRevenue) },
                    { label: "حصة العيادة", value: formatCurrency(s.totalClinicShare) },
                    { label: "مصروفات عامة", value: formatCurrency(s.generalExpenses) },
                    { label: "رواتب وسلف", value: formatCurrency(s.staffSalaries) },
                    { label: "صرف أطباء", value: formatCurrency(s.doctorPayouts) },
                    { label: "ديون مفتوحة", value: formatCurrency(s.outstandingDebts) },
                    { label: "صافي الربح", value: formatCurrency(s.netProfit) },
                    {
                      label: "مقبوضات اليوم",
                      value: formatCurrency(report.today.totalCollected),
                    },
                    {
                      label: "عمليات الشهر",
                      value: String(report.month.operationsCount),
                    },
                  ],
                });
              } finally {
                setPdfLoading(false);
              }
            }}
          />
          <MasterReportDocument
            report={report}
            title="تقرير العيادة الشامل"
            subtitle="إعداد المحاسب — للتسليم لصاحب العيادة"
          />
        </div>
      )}
    </div>
  );
}
