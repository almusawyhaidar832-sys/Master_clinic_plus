"use client";

import { useEffect, useRef } from "react";
import { subscribeQueueRefresh, type QueueRefreshScope } from "@/lib/queue/queue-refresh";
import { subscribeClinicSync } from "@/lib/sync/clinic-events";

/** Auto-refetch queue list when realtime/broadcast/global sync fires */
export function useQueueListRefresh(
  scope: QueueRefreshScope,
  id: string | null | undefined,
  onRefresh: () => void
) {
  const onRefreshRef = useRef(onRefresh);
  onRefreshRef.current = onRefresh;

  useEffect(() => {
    if (!id) return;

    const run = () => onRefreshRef.current();

    const unsubQueue = subscribeQueueRefresh((detail) => {
      if (detail.scope === "doctor" && scope === "doctor" && detail.doctorId === id) {
        run();
      }
      if (detail.scope === "clinic" && scope === "clinic" && detail.clinicId === id) {
        run();
      }
    });

    const unsubSync = subscribeClinicSync(run, {
      topics: ["queue", "all"],
      clinicId: scope === "clinic" ? id : undefined,
      doctorId: scope === "doctor" ? id : undefined,
    });

    return () => {
      unsubQueue();
      unsubSync();
    };
  }, [scope, id]);
}
