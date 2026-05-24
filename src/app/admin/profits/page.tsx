"use client";

import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { ProfitDashboard } from "@/components/admin/ProfitDashboard";
import { FileText } from "lucide-react";

export default function ClinicProfitsPage() {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-bold text-slate-text">أرباح العيادة</h2>
        <p className="text-sm text-slate-muted">ملخص مالي — محسّن للجوال</p>
      </div>

      <Link href="/admin/report">
        <Button className="w-full">
          <FileText className="h-4 w-4" />
          إنشاء التقرير المالي الشامل
        </Button>
      </Link>

      <ProfitDashboard mobile />
    </div>
  );
}
