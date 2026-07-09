"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { Alert } from "@/components/ui/Alert";
import { MasterReportDocument } from "@/components/reports/MasterReportDocument";
import { ReportActions } from "@/components/reports/ReportActions";
import { OfflineViewBanner } from "@/components/offline/OfflineViewBanner";
import { fetchMasterClinicReportViaApi } from "@/lib/services/clinic-reports-api";
import {
  getReportPeriodOptions,
  type MasterClinicReport,
} from "@/lib/services/clinic-reports";
import { currentMonthYear } from "@/lib/utils";
import { isBrowserOffline } from "@/lib/offline/network";
import {
  readMasterReportCache,
  writeMasterReportCache,
} from "@/lib/offline/master-report-cache";
import { downloadClinicReportPdf } from "@/lib/reports/pdf-export";
import { prewarmPdfEngine } from "@/lib/reports/pdf-prewarm";
import { FileText, Loader2 } from "lucide-react";

export default function AdminMasterReportPage() {
  const [monthYear, setMonthYear] = useState(currentMonthYear());
  const [report, setReport] = useState<MasterClinicReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [offlineView, setOfflineView] = useState(false);
  const [cachedAt, setCachedAt] = useState<number | null>(null);
  const [pdfLoading, setPdfLoading] = useState(false);

  const periodOptions = getReportPeriodOptions();

  useEffect(() => {
    if (!isBrowserOffline()) void prewarmPdfEngine();
  }, []);

  useEffect(() => {
    const cached = readMasterReportCache("admin", monthYear);
    if (cached) {
      setReport(cached.report);
      setCachedAt(cached.cachedAt);
      setOfflineView(isBrowserOffline());
      return;
    }
    if (isBrowserOffline()) {
      setReport(null);
      setOfflineView(true);
      setError("لا يوجد اتصال — أنشئ التقرير مرة مع النت أولاً");
    }
  }, [monthYear]);

  async function generateReport() {
    if (isBrowserOffline()) {
      const cached = readMasterReportCache("admin", monthYear);
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
      const data = await fetchMasterClinicReportViaApi(monthYear);
      setReport(data);
      writeMasterReportCache("admin", monthYear, data);
      setOfflineView(false);
      setCachedAt(Date.now());
      void prewarmPdfEngine();
    } catch {
      const cached = readMasterReportCache("admin", monthYear);
      if (cached) {
        setReport(cached.report);
        setCachedAt(cached.cachedAt);
        setOfflineView(true);
        setError("تعذر التحديث — عرض نسخة محفوظة");
      } else {
        setError("تعذر إنشاء التقرير");
      }
    }
    setLoading(false);
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-bold text-slate-text">التقرير المالي الشامل</h2>
        <p className="text-sm text-slate-muted">
          إيرادات، مصروفات، رواتب، أطباء، وديون — للطباعة والمشاركة
        </p>
      </div>

      <OfflineViewBanner
        refreshing={false}
        offline={offlineView}
        cachedAt={cachedAt}
        refreshingLabel="عرض سريع من الذاكرة — جاري التحديث من السيرفر…"
        offlineLabel="بدون اتصال — آخر تحديث: {time}"
      />

      <div className="no-print space-y-3 rounded-xl border border-slate-border bg-surface-card p-4">
        <Select
          label="الفترة"
          value={monthYear}
          onChange={(e) => {
            setMonthYear(e.target.value);
            setReport(null);
            setError(null);
            setOfflineView(false);
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
              جاري التجميع...
            </>
          ) : (
            <>
              <FileText className="h-5 w-5" />
              {offlineView && report ? "عرض النسخة المحفوظة" : "إنشاء التقرير الشامل"}
            </>
          )}
        </Button>
      </div>

      {error && <Alert variant="error">{error}</Alert>}

      {report && (
        <div className="space-y-4">
          <ReportActions
            shareTitle={`التقرير المالي — ${report.clinicName} — ${report.periodLabel}`}
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
            title="التقرير المالي الشامل للعيادة"
            subtitle="تقرير المالك — Master Clinic Plus"
          />
        </div>
      )}
    </div>
  );
}
