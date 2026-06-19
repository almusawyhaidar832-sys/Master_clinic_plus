"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { Alert } from "@/components/ui/Alert";
import { MasterReportDocument } from "@/components/reports/MasterReportDocument";
import { ReportActions } from "@/components/reports/ReportActions";
import { fetchMasterClinicReportViaApi } from "@/lib/services/clinic-reports-api";
import {
  getReportPeriodOptions,
  type MasterClinicReport,
} from "@/lib/services/clinic-reports";
import { currentMonthYear } from "@/lib/utils";
import { FileText, Loader2 } from "lucide-react";

export default function AdminMasterReportPage() {
  const [monthYear, setMonthYear] = useState(currentMonthYear());
  const [report, setReport] = useState<MasterClinicReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const periodOptions = getReportPeriodOptions();

  async function generateReport() {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchMasterClinicReportViaApi(monthYear);
      setReport(data);
    } catch {
      setError("تعذر إنشاء التقرير");
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

      <div className="no-print space-y-3 rounded-xl border border-slate-border bg-surface-card p-4">
        <Select
          label="الفترة"
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
              جاري التجميع...
            </>
          ) : (
            <>
              <FileText className="h-5 w-5" />
              إنشاء التقرير الشامل
            </>
          )}
        </Button>
      </div>

      {error && <Alert variant="error">{error}</Alert>}

      {report && (
        <div className="space-y-4">
          <ReportActions
            shareTitle={`التقرير المالي — ${report.clinicName} — ${report.periodLabel}`}
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
