"use client";

import { FileDown, Printer, Share2 } from "lucide-react";

interface ReportActionsProps {
  shareTitle: string;
  printTargetId?: string;
  onExportPdf?: () => void | Promise<void>;
  pdfLoading?: boolean;
}

export function ReportActions({
  shareTitle,
  printTargetId = "master-clinic-report-print",
  onExportPdf,
  pdfLoading = false,
}: ReportActionsProps) {
  function handlePrint() {
    window.print();
  }

  async function handleShare() {
    const el = document.getElementById(printTargetId);
    const text = el?.innerText?.slice(0, 500) ?? shareTitle;
    if (navigator.share) {
      try {
        await navigator.share({ title: shareTitle, text });
      } catch {
        /* cancelled */
      }
    } else if (navigator.clipboard) {
      await navigator.clipboard.writeText(text);
      alert("تم نسخ ملخص التقرير");
    }
  }

  return (
    <div className="no-print mc-panel flex flex-wrap gap-2 p-2.5">
      {onExportPdf && (
        <button
          type="button"
          className="mc-btn-soft min-w-[8rem] flex-1 py-2.5"
          disabled={pdfLoading}
          onClick={() => void onExportPdf()}
        >
          <FileDown className="h-4 w-4 text-premium-500" />
          {pdfLoading ? "جاري التصدير..." : "تصدير PDF"}
        </button>
      )}
      <button
        type="button"
        className="mc-btn-navy min-w-[8rem] flex-1 py-2.5"
        onClick={handlePrint}
      >
        <Printer className="h-4 w-4 text-premium-300" />
        طباعة
      </button>
      <button
        type="button"
        className="mc-btn-soft min-w-[8rem] flex-1 py-2.5"
        onClick={handleShare}
      >
        <Share2 className="h-4 w-4 text-premium-500" />
        مشاركة
      </button>
    </div>
  );
}
