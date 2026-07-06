"use client";

import { DailyCollectionsPanel } from "@/components/accountant/DailyCollectionsPanel";
import { PageHeader } from "@/components/ui/PageHeader";
import { Calendar } from "lucide-react";

export default function AdminDailyCollectionsPage() {
  return (
    <div className="space-y-5 animate-fade-in">
      <PageHeader
        title="كشف مالي"
        subtitle="مدفوعات المراجعين، حصص الأطباء، وأجور المساعدين — مثل لوحة المحاسب"
        actions={
          <span className="mc-icon-badge-primary">
            <Calendar className="h-4 w-4" />
          </span>
        }
      />
      <DailyCollectionsPanel />
    </div>
  );
}
