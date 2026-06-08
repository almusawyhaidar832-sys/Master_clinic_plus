"use client";

import { useEffect } from "react";
import { subscribeQueueRefresh, type QueueRefreshScope } from "@/lib/queue/queue-refresh";

/** Auto-refetch queue list when realtime/broadcast fires */
export function useQueueListRefresh(
  scope: QueueRefreshScope,
  id: string | null | undefined,
  onRefresh: () => void
) {
  useEffect(() => {
    if (!id) return;
    return subscribeQueueRefresh((detail) => {
      if (detail.scope === "doctor" && scope === "doctor" && detail.doctorId === id) {
        onRefresh();
      }
      if (detail.scope === "clinic" && scope === "clinic" && detail.clinicId === id) {
        onRefresh();
      }
    });
  }, [scope, id, onRefresh]);
}
