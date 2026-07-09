"use client";

import { useEffect, type ReactNode } from "react";
import { useOfflineReferenceBootstrap } from "@/lib/offline/hooks/useOfflineReferenceBootstrap";
import { OfflineSyncBanner } from "@/components/offline/OfflineSyncBanner";
import { installReconnectCoordinator } from "@/lib/offline/reconnect-coordinator";

/**
 * المرحلة 1 من العمل بدون نت:
 * - IndexedDB لطابور إدخال المحاسب
 * - مزامنة تلقائية عند عودة النت
 */
export function OfflineSyncProvider({ children }: { children: ReactNode }) {
  useOfflineReferenceBootstrap();

  useEffect(() => installReconnectCoordinator(), []);

  return (
    <>
      <OfflineSyncBanner />
      {children}
    </>
  );
}
