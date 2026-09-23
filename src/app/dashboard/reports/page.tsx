"use client";

import { useEffect, useState } from "react";
import { Select } from "@/components/ui/Select";
import { Alert } from "@/components/ui/Alert";
import { PageHeader } from "@/components/ui/PageHeader";
import { useLanguage } from "@/contexts/LanguageContext";
import { MasterReportDocument } from "@/components/reports/MasterReportDocument";
import { MonthlySettlementDocument } from "@/components/reports/MonthlySettlementDocument";
import { ReportActions } from "@/components/reports/ReportActions";
import { OfflineViewBanner } from "@/components/offline/OfflineViewBanner";
import {
  downloadClinicReportPdf,
  downloadSettlementPdf,
} from "@/lib/reports/pdf-export";
import { prewarmPdfEngine } from "@/lib/reports/pdf-prewarm";
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
import {
  readSettlementReportCache,
  writeSettlementReportCache,
} from "@/lib/offline/settlement-report-cache";
import {
  FileText,
  Loader2,
  ClipboardList,
  Scale,
  FileBarChart,
  CalendarDays,
  ListChecks,
  CheckCircle2,
} from "lucide-react";

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
  const [settlementOfflineView, setSettlementOfflineView] = useState(false);
  const [settlementCachedAt, setSettlementCachedAt] = useState<number | null>(
    null
  );

  const { bi } = useLanguage();
  const periodOptions = getReportPeriodOptions();

  useEffect(() => {
    if (!isBrowserOffline()) void prewarmPdfEngine();
  }, []);

  useEffect(() => {
    const cachedReport = readMasterReportCache("accountant", monthYear);
    const cachedSettlement = readSettlementReportCache("accountant", monthYear);

    if (cachedReport) {
      setReport(cachedReport.report);
      setCachedAt(cachedReport.cachedAt);
      setOfflineView(isBrowserOffline());
    } else {
      setReport(null);
      setOfflineView(isBrowserOffline());
    }

    if (cachedSettlement) {
      setSettlement(cachedSettlement.report);
      setSettlementCachedAt(cachedSettlement.cachedAt);
      setSettlementOfflineView(isBrowserOffline());
    } else {
      setSettlement(null);
      setSettlementOfflineView(false);
      setSettlementCachedAt(null);
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
    try {
      const supabase = createClient();
      const data = await fetchAccountantClinicReport(supabase, monthYear);
      setReport(data);
      writeMasterReportCache("accountant", monthYear, data);
      setOfflineView(false);
      setCachedAt(Date.now());
      void prewarmPdfEngine();
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
    if (isBrowserOffline()) {
      const cached = readSettlementReportCache("accountant", monthYear);
      if (cached) {
        setSettlement(cached.report);
        setSettlementCachedAt(cached.cachedAt);
        setSettlementOfflineView(true);
        setError(null);
        return;
      }
      setError("لا يوجد اتصال — أنشئ كشف التسوية مرة مع النت أولاً");
      return;
    }

    setSettlementLoading(true);
    setError(null);
    try {
      const supabase = createClient();
      const data = await fetchMonthlySettlementReport(supabase, monthYear);
      setSettlement(data);
      writeSettlementReportCache("accountant", monthYear, data);
      setSettlementOfflineView(false);
      setSettlementCachedAt(Date.now());
      void prewarmPdfEngine();
    } catch {
      const cached = readSettlementReportCache("accountant", monthYear);
      if (cached) {
        setSettlement(cached.report);
        setSettlementCachedAt(cached.cachedAt);
        setSettlementOfflineView(true);
        setError("تعذر التحديث — عرض نسخة محفوظة من كشف التسوية");
      } else {
        setError("تعذر تجميع كشف التسوية. تحقق من الاتصال وقاعدة البيانات.");
      }
    }
    setSettlementLoading(false);
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader
        title="تقارير العيادة"
        eyebrow={bi("التقارير والتحليلات", "Reports & analytics")}
        icon={FileBarChart}
        subtitle="تقرير شامل للمالك — عمليات يومية وشهرية، مصروفات، سلف الموظفين، وأطباء"
      />

      <OfflineViewBanner
        refreshing={false}
        offline={offlineView && !!report}
        cachedAt={cachedAt}
        refreshingLabel="عرض سريع من الذاكرة — جاري التحديث من السيرفر…"
        offlineLabel="بدون اتصال — آخر تحديث للتقرير: {time}"
      />

      <OfflineViewBanner
        refreshing={false}
        offline={settlementOfflineView && !!settlement}
        cachedAt={settlementCachedAt}
        refreshingLabel="عرض سريع من الذاكرة — جاري التحديث من السيرفر…"
        offlineLabel="بدون اتصال — آخر تحديث لكشف التسوية: {time}"
      />

      <div className="mc-panel">
        <div className="mc-panel-head">
          <p className="mc-panel-title">
            <CalendarDays />
            الشهر
          </p>
        </div>
        <div className="mc-panel-body">
          <Select
            value={monthYear}
            onChange={(e) => {
              setMonthYear(e.target.value);
              setError(null);
            }}
            options={periodOptions}
            className="h-11 rounded-xl font-semibold"
          />
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="mc-hero flex flex-col rounded-3xl p-6">
          <div className="relative flex items-start gap-3.5">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white/10 text-premium-300 ring-1 ring-inset ring-white/15">
              <ClipboardList className="h-6 w-6" strokeWidth={1.75} />
            </span>
            <div className="min-w-0">
              <h3 className="text-lg font-extrabold tracking-tight text-white">
                تقرير تسليم للمالك
              </h3>
              <p className="mt-1.5 text-sm leading-relaxed text-white/70">
                بنقرة واحدة يُجمّع كل إحصائيات العيادة المالية في تقرير
                جاهز للطباعة أو المشاركة مع صاحب العيادة.
              </p>
            </div>
          </div>
          <div className="relative mt-auto pt-6">
            <button
              type="button"
              className="mc-btn-pearl w-full py-3 text-base"
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
                  {offlineView && report
                    ? "عرض التقرير المحفوظ"
                    : "إنشاء تقرير العيادة الكامل"}
                </>
              )}
            </button>
          </div>
        </div>

        <div className="mc-panel flex flex-col p-6">
          <div className="flex items-start gap-3.5">
            <span className="mc-kpi__icon mc-tone-gold h-12 w-12 rounded-2xl">
              <Scale className="h-6 w-6" strokeWidth={1.75} />
            </span>
            <div className="min-w-0">
              <h3 className="text-lg font-extrabold tracking-tight text-slate-text">
                كشف التسوية الشهرية
              </h3>
              <p className="mt-1.5 text-sm leading-relaxed text-slate-muted">
                يجمع تصفية كل الأطباء — خصم حصة العيادة والمصاريف ورواتب
                المساعدين — ويعطي الصافي النهائي لكل طبيب وللعيادة.
              </p>
            </div>
          </div>
          <div className="mt-auto pt-6">
            <button
              type="button"
              className="mc-btn-navy w-full py-3 text-base"
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
                  <Scale className="h-5 w-5 text-premium-300" />
                  {settlementOfflineView && settlement
                    ? "عرض كشف التسوية المحفوظ"
                    : "إصدار كشف حساب شهري (تسوية)"}
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      <div className="mc-panel">
        <div className="mc-panel-head">
          <p className="mc-panel-title">
            <ListChecks />
            يتضمن التقرير
          </p>
        </div>
        <ul className="grid gap-2.5 p-5 text-sm text-slate-muted sm:grid-cols-2">
          {[
            "ملخص الإيرادات والمصروفات والرواتب ومستحقات الأطباء",
            "عمليات اليوم والشهر مع المقبوضات والديون",
            "قائمة المصروفات العامة للفترة",
            "تفاصيل سلف وخصومات الموظفين",
            "حسابات الأطباء وطلبات السحب المعلّقة",
            "سجل عمليات الشهر (حتى 50 عملية في الطباعة)",
          ].map((item) => (
            <li key={item} className="flex items-start gap-2.5">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-premium-500" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </div>

      {error && <Alert variant="error">{error}</Alert>}

      {settlement && (
        <div className="space-y-4">
          <Alert variant="success">
            تم إنشاء كشف التسوية — جاهز للطباعة أو تصدير PDF
          </Alert>
          <ReportActions
            shareTitle={`تسوية شهرية — ${settlement.clinicName} — ${settlement.periodLabel}`}
            pdfLoading={settlementPdfLoading}
            onExportPdf={async () => {
              setSettlementPdfLoading(true);
              try {
                await prewarmPdfEngine();
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
                await prewarmPdfEngine();
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
