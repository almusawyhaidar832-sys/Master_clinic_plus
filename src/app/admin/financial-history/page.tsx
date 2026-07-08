"use client";

import { PageHeader } from "@/components/ui/PageHeader";
import { ClinicFinancialHistoryPanel } from "@/components/admin/ClinicFinancialHistoryPanel";

export default function AdminFinancialHistoryPage() {
  return (
    <div className="space-y-5 animate-fade-in">
      <PageHeader
        title="سجل الصرفيات والأجور"
        subtitle="أرشيف كامل لكل ما أثّر على ربح العيادة — سابقاً وحالياً"
      />
      <ClinicFinancialHistoryPanel mobile />
    </div>
  );
}
