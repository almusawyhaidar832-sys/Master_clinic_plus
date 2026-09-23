"use client";

import { ActivityFeed } from "@/components/admin/ActivityFeed";
import { PageHeader } from "@/components/ui/PageHeader";
import { useLanguage } from "@/contexts/LanguageContext";
import { Activity } from "lucide-react";

export default function DashboardActivityPage() {
  const { bi } = useLanguage();
  return (
    <div className="mx-auto max-w-4xl space-y-6 p-4 sm:p-6">
      <PageHeader
        eyebrow={bi("الرقابة والتدقيق", "Audit & oversight")}
        title="سجل المراقبة"
        subtitle="شفافية كاملة — تتبّع المرتجعات والتعديلات والعمليات الحساسة"
        icon={Activity}
        className="mb-0"
      />
      <ActivityFeed authPortal="accountant" pollMs={20_000} />
    </div>
  );
}
