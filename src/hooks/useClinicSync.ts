"use client";

import { useEffect, useRef } from "react";
import {
  subscribeClinicSync,
  type ClinicSyncDetail,
  type ClinicSyncTopic,
} from "@/lib/sync/clinic-events";

const SYNC_DEBOUNCE_MS = 400;

export interface UseClinicSyncOptions {
  topics: ClinicSyncTopic[];
  clinicId?: string | null;
  doctorId?: string | null;
  patientId?: string | null;
  onRefresh: (detail?: ClinicSyncDetail) => void;
  enabled?: boolean;
}

/**
 * اشتراك في المزامنة المركزية — يُحدّث الصفحة تلقائياً عند أي تغيّر ذي صلة.
 */
export function useClinicSync({
  topics,
  clinicId,
  doctorId,
  patientId,
  onRefresh,
  enabled = true,
}: UseClinicSyncOptions): void {
  const onRefreshRef = useRef(onRefresh);
  onRefreshRef.current = onRefresh;

  const topicsKey = topics.join(",");

  useEffect(() => {
    if (!enabled) return;

    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    let pendingDetail: ClinicSyncDetail | undefined;

    const flush = () => {
      debounceTimer = null;
      onRefreshRef.current(pendingDetail);
      pendingDetail = undefined;
    };

    const unsub = subscribeClinicSync(
      (detail) => {
        pendingDetail = detail;
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(flush, SYNC_DEBOUNCE_MS);
      },
      { topics, clinicId, doctorId, patientId }
    );

    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      unsub();
    };
    // topicsKey stabilizes array dependency
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, topicsKey, clinicId, doctorId, patientId]);
}
