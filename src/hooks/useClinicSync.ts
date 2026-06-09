"use client";

import { useEffect, useRef } from "react";
import {
  subscribeClinicSync,
  type ClinicSyncTopic,
} from "@/lib/sync/clinic-events";

export interface UseClinicSyncOptions {
  topics: ClinicSyncTopic[];
  clinicId?: string | null;
  doctorId?: string | null;
  patientId?: string | null;
  onRefresh: () => void;
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

    return subscribeClinicSync(
      () => {
        onRefreshRef.current();
      },
      { topics, clinicId, doctorId, patientId }
    );
    // topicsKey stabilizes array dependency
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, topicsKey, clinicId, doctorId, patientId]);
}
