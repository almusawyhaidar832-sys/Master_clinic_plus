"use client";

import { Button } from "@/components/ui/Button";
import { Printer, Share2 } from "lucide-react";

interface ReportActionsProps {
  shareTitle: string;
  printTargetId?: string;
}

export function ReportActions({
  shareTitle,
  printTargetId = "master-clinic-report-print",
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
    <div className="no-print flex gap-2">
      <Button className="flex-1" onClick={handlePrint}>
        <Printer className="h-4 w-4" />
        طباعة
      </Button>
      <Button variant="outline" className="flex-1" onClick={handleShare}>
        <Share2 className="h-4 w-4" />
        مشاركة
      </Button>
    </div>
  );
}
