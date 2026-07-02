"use client";

import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { ProfitDashboard } from "@/components/admin/ProfitDashboard";
import { currentMonthYear } from "@/lib/utils";
import { FileText, TrendingUp } from "lucide-react";

export default function ClinicProfitsPage() {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="flex items-center gap-2 text-xl font-bold tracking-tight text-slate-text">
          <span className="mc-icon-badge-primary">
            <TrendingUp className="h-4.5 w-4.5" />
          </span>
          أرباح العيادة
        </h2>
        <p className="mt-1 text-sm text-slate-muted">
          ملخص شهر {currentMonthYear()} — نفس منطق التقرير الشامل
        </p>
      </div>

      <Link href="/admin/report">
        <Button className="w-full" variant="premium">
          <FileText className="h-4 w-4" />
          إنشاء التقرير المالي الشامل
        </Button>
      </Link>

      <ProfitDashboard mobile />
    </div>
  );
}
