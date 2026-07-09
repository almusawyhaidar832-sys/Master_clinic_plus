"use client";

import { ActivityFeed } from "@/components/admin/ActivityFeed";
import { ClearClinicTopUpsButton } from "@/components/finance/ClearClinicTopUpsButton";
import { Activity } from "lucide-react";

export default function AdminActivityPage() {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-bold text-slate-text">
            <Activity className="h-6 w-6 text-primary" />
            سجل المراقبة
          </h2>
          <p className="mt-1 text-sm text-slate-muted">
            كل التعديلات والمرتجعات والحذف — يُحدَّث تلقائياً
          </p>
        </div>
        <ClearClinicTopUpsButton portal="admin" variant="danger" />
      </div>
      <ActivityFeed authPortal="admin" pollMs={20_000} />
    </div>
  );
}
