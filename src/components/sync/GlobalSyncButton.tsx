"use client";

import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { forceGlobalResync } from "@/lib/sync/clinic-events";

interface GlobalSyncButtonProps {
  clinicId: string | null | undefined;
}

/**
 * زر إعادة مزامنة عامة — للمدير فقط.
 * يُعيد جلب كل القوائم عبر الحافلة المركزية دون إعادة تحميل الصفحة.
 */
export function GlobalSyncButton({ clinicId }: GlobalSyncButtonProps) {
  const [syncing, setSyncing] = useState(false);

  async function handleSync() {
    if (!clinicId || syncing) return;
    setSyncing(true);
    forceGlobalResync(clinicId);
    // Brief visual feedback — pages refetch asynchronously
    await new Promise((r) => setTimeout(r, 600));
    setSyncing(false);
  }

  return (
    <button
      type="button"
      onClick={() => void handleSync()}
      disabled={!clinicId || syncing}
      title="إعادة مزامنة كل البيانات"
      className={cn(
        "flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-xs font-bold transition-colors",
        "text-slate-muted hover:bg-surface hover:text-slate-text",
        "disabled:cursor-not-allowed disabled:opacity-50"
      )}
    >
      <RefreshCw className={cn("h-4 w-4", syncing && "animate-spin")} />
      <span className="hidden sm:inline">
        {syncing ? "جاري المزامنة..." : "مزامنة عامة"}
      </span>
    </button>
  );
}
