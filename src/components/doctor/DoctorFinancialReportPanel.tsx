"use client";

import { useCallback, useState } from "react";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { ReportActions } from "@/components/reports/ReportActions";
import {
  DoctorFinancialReportDocument,
  DOCTOR_FINANCIAL_REPORT_PRINT_ID,
} from "@/components/doctor/DoctorFinancialReportDocument";
import { authPortalHeaders } from "@/lib/auth/api-portal";
import type { DoctorFinancialReportData } from "@/lib/services/doctor-financial-ledger";
import { downloadElementAsPdf } from "@/lib/reports/pdf-from-html";
import { useLanguage } from "@/contexts/LanguageContext";
import { FileBarChart, Loader2 } from "lucide-react";

export function DoctorFinancialReportPanel() {
  const { t, bi } = useLanguage();
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [report, setReport] = useState<DoctorFinancialReportData | null>(null);
  const [loading, setLoading] = useState(false);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);

  const loadReport = useCallback(async () => {
    setLoading(true);
    setError("");

    const params = new URLSearchParams();
    if (dateFrom) params.set("date_from", dateFrom);
    if (dateTo) params.set("date_to", dateTo);

    try {
      const res = await fetch(
        `/api/doctor/financial-ledger/report?${params}`,
        {
          credentials: "include",
          headers: authPortalHeaders("doctor"),
        }
      );
      const json = (await res.json()) as {
        report?: DoctorFinancialReportData;
        error?: string;
      };

      if (!res.ok) {
        setError(json.error ?? t("docReportFailed"));
        setReport(null);
        return;
      }

      setReport(json.report ?? null);
      setOpen(true);
    } catch {
      setError(t("errServerConnection"));
    } finally {
      setLoading(false);
    }
  }, [dateFrom, dateTo, t]);

  return (
    <section className="mc-panel">
      <div className="flex items-start gap-3 border-b border-slate-border px-4 py-3.5">
        <span className="mc-icon-tile h-10 w-10">
          <FileBarChart className="h-[18px] w-[18px]" />
        </span>
        <div className="min-w-0">
          <h2 className="no-accent text-sm font-bold text-slate-text">
            {t("docFinancialReportShort")}
          </h2>
          <p className="mt-0.5 text-xs leading-relaxed text-slate-muted">
            {t("docFinancialReportDesc")}
          </p>
        </div>
      </div>

      <div className="space-y-3 p-4">
        <div className="grid grid-cols-2 gap-2.5">
          <Input
            label={t("docFromDate")}
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            dir="ltr"
            className="h-11 rounded-xl text-left"
          />
          <Input
            label={t("docToDate")}
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            dir="ltr"
            className="h-11 rounded-xl text-left"
          />
        </div>

        {error && <Alert variant="error">{error}</Alert>}

        <Button
          type="button"
          className="min-h-[48px] w-full rounded-xl"
          disabled={loading}
          onClick={() => void loadReport()}
        >
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <FileBarChart className="h-4 w-4" />
          )}
          {loading ? t("docPreparingReport") : t("docGenerateReport")}
        </Button>
      </div>

      {open && report && (
        <div className="space-y-3 border-t border-slate-border p-4">
          <ReportActions
            shareTitle={bi(
              `تقرير مالي — ${report.doctor_name_ar}`,
              `Financial report — ${report.doctor_name_ar}`
            )}
            printTargetId={DOCTOR_FINANCIAL_REPORT_PRINT_ID}
            pdfLoading={pdfLoading}
            onExportPdf={async () => {
              setPdfLoading(true);
              try {
                await downloadElementAsPdf(
                  DOCTOR_FINANCIAL_REPORT_PRINT_ID,
                  `financial-report-${report.doctor_name_ar}`
                );
              } finally {
                setPdfLoading(false);
              }
            }}
          />
          <DoctorFinancialReportDocument report={report} />
        </div>
      )}
    </section>
  );
}
