"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { Card, CardHeader, CardTitle } from "@/components/ui/Card";
import { Alert } from "@/components/ui/Alert";
import { MasterReportDocument } from "@/components/reports/MasterReportDocument";
import { MonthlySettlementDocument } from "@/components/reports/MonthlySettlementDocument";
import { ReportActions } from "@/components/reports/ReportActions";
import { OfflineViewBanner } from "@/components/offline/OfflineViewBanner";
import {
  downloadClinicReportPdf,
  downloadSettlementPdf,
} from "@/lib/reports/pdf-export";
import { createClient } from "@/lib/supabase/client";
import {
  fetchAccountantClinicReport,
  fetchMonthlySettlementReport,
  getReportPeriodOptions,
  type MasterClinicReport,
  type MonthlySettlementReport,
} from "@/lib/services/clinic-reports";
import { currentMonthYear } from "@/lib/utils";
import { isBrowserOffline } from "@/lib/offline/network";
import {
  readMasterReportCache,
  writeMasterReportCache,
} from "@/lib/offline/master-report-cache";
import { FileText, Loader2, ClipboardList, Scale } from "lucide-react";

export default function AccountantReportsPage() {
  const [monthYear, setMonthYear] = useState(currentMonthYear());
  const [report, setReport] = useState<MasterClinicReport | null>(null);
  const [settlement, setSettlement] = useState<MonthlySettlementReport | null>(
    null
  );
  const [loading, setLoading] = useState(false);
  const [settlementLoading, setSettlementLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [settlementPdfLoading, setSettlementPdfLoading] = useState(false);
  const [offlineView, setOfflineView] = useState(false);
  const [cachedAt, setCachedAt] = useState<number | null>(null);

  const periodOptions = getReportPeriodOptions();

  useEffect(() => {
    const cached = readMasterReportCache("accountant", monthYear);
    if (cached) {
      setReport(cached.report);
      setCachedAt(cached.cachedAt);
      setOfflineView(isBrowserOffline());
      return;
    }
    if (isBrowserOffline()) {
      setReport(null);
      setOfflineView(true);
    }
  }, [monthYear]);

  async function generateReport() {
    if (isBrowserOffline()) {
      const cached = readMasterReportCache("accountant", monthYear);
      if (cached) {
        setReport(cached.report);
        setCachedAt(cached.cachedAt);
        setOfflineView(true);
        setError(null);
        return;
      }
      setError("لا يوجد اتصال — أنشئ التقرير مرة مع النت أولاً");
      return;
    }

    setLoading(true);
    setError(null);
    setSettlement(null);
    try {
      const supabase = createClient();
      const data = await fetchAccountantClinicReport(supabase, monthYear);
      setReport(data);
      writeMasterReportCache("accountant", monthYear, data);
      setOfflineView(false);
      setCachedAt(Date.now());
    } catch {
      const cached = readMasterReportCache("accountant", monthYear);
      if (cached) {
        setReport(cached.report);
        setCachedAt(cached.cachedAt);
        setOfflineView(true);
        setError("تعذر التحديث — عرض نسخة محفوظة");
      } else {
        setError("تعذر تجميع التقرير. تحقق من الاتصال وقاعدة البيانات.");
      }
    }
    setLoading(false);
  }

  async function generateSettlement() {
    setSettlementLoading(true);
    setError(null);
    try {
      const supabase = createClient();
      const data = await fetchMonthlySettlementReport(supabase, monthYear);
      setSettlement(data);
    } catch {
      setError("تعذر تجميع كشف التسوية. تحقق من الاتصال وقاعدة البيانات.");
    }
    setSettlementLoading(false);
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

      <OfflineViewBanner
        refreshing={false}
        offline={offlineView}
        cachedAt={cachedAt}
        refreshingLabel="عرض سريع من الذاكرة — جاري التحديث من السيرفر…"
        offlineLabel="بدون اتصال — آخر تحديث: {time}"
      />

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
              setSettlement(null);
              setOfflineView(false);
              setError(null);
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

      <Card className="border-amber-200/60 bg-amber-50/30">
        <CardHeader>
          <div className="flex items-start gap-3">
            <div className="rounded-lg bg-amber-100 p-2">
              <Scale className="h-6 w-6 text-amber-700" />
            </div>
            <div>
              <CardTitle>كشف التسوية الشهرية</CardTitle>
              <p className="mt-1 text-sm text-slate-muted">
                يجمع تصفية كل الأطباء — خصم حصة العيادة والمصاريف ورواتب
                المساعدين — ويعطي الصافي النهائي لكل طبيب وللعيادة.
              </p>
            </div>
          </div>
        </CardHeader>
        <Button
          className="w-full"
          variant="outline"
          onClick={generateSettlement}
          disabled={settlementLoading}
        >
          {settlementLoading ? (
            <>
              <Loader2 className="h-5 w-5 animate-spin" />
              جاري تجميع كشف التسوية...
            </>
          ) : (
            <>
              <Scale className="h-5 w-5" />
              إصدار كشف حساب شهري (تسوية)
            </>
          )}
        </Button>
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

      {settlement && (
        <div className="space-y-4">
          <Alert variant="success">
            تم إنشاء كشف التسوية — جاهز للتصدير PDF
          </Alert>
          <ReportActions
            shareTitle={`تسوية شهرية — ${settlement.clinicName} — ${settlement.periodLabel}`}
            pdfLoading={settlementPdfLoading}
            onExportPdf={async () => {
              setSettlementPdfLoading(true);
              try {
                await downloadSettlementPdf({
                  periodLabel: settlement.periodLabel,
                  elementId: "monthly-settlement-print",
                });
              } finally {
                setSettlementPdfLoading(false);
              }
            }}
          />
          <MonthlySettlementDocument report={settlement} />
        </div>
      )}

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
                await downloadClinicReportPdf({
                  clinicName: report.clinicName,
                  periodLabel: report.periodLabel,
                  generatedAt: new Date().toLocaleString("ar-IQ"),
                  elementId: "master-clinic-report-print",
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
