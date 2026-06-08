"use client";

export type QueueRefreshScope = "doctor" | "clinic";

export interface QueueRefreshDetail {
  scope: QueueRefreshScope;
  doctorId?: string;
  clinicId?: string;
}

const QUEUE_REFRESH_EVENT = "master-clinic-queue-refresh";

/** Tell open queue pages to refetch without manual refresh */
export function notifyQueueRefresh(detail: QueueRefreshDetail) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(QUEUE_REFRESH_EVENT, { detail }));
}

export function subscribeQueueRefresh(
  handler: (detail: QueueRefreshDetail) => void
): () => void {
  if (typeof window === "undefined") return () => {};

  const listener = (event: Event) => {
    handler((event as CustomEvent<QueueRefreshDetail>).detail);
  };

  window.addEventListener(QUEUE_REFRESH_EVENT, listener);
  return () => window.removeEventListener(QUEUE_REFRESH_EVENT, listener);
}
