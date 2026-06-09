"use client";

import { ActivityFeed } from "@/components/admin/ActivityFeed";
import { Activity } from "lucide-react";

export default function DashboardActivityPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4 sm:p-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-text">
          <Activity className="h-7 w-7 text-primary" />
          سجل المراقبة
        </h1>
        <p className="mt-1 text-sm text-slate-muted">
          شفافية كاملة — تتبّع المرتجعات والتعديلات والعمليات الحساسة
        </p>
      </div>
      <ActivityFeed authPortal="accountant" pollMs={20_000} />
    </div>
  );
}
