"use client";

import type { ReactNode } from "react";
import { useOfflineReferenceBootstrap } from "@/lib/offline/hooks/useOfflineReferenceBootstrap";
import { OfflineSyncBanner } from "@/components/offline/OfflineSyncBanner";

/**
 * المرحلة 1 من العمل بدون نت:
 * - IndexedDB لطابور إدخال المحاسب
 * - مزامنة تلقائية عند عودة النت
 */
export function OfflineSyncProvider({ children }: { children: ReactNode }) {
  useOfflineReferenceBootstrap();

  return (
    <>
      <OfflineSyncBanner />
      {children}
    </>
  );
}
