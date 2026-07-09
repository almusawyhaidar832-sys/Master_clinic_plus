"use client";

import { Alert } from "@/components/ui/Alert";
import { formatDailyCollectionsCachedAt } from "@/lib/ledger/daily-collections-cache";

export function DailyCollectionsCacheBanner({
  refreshing,
  offline,
  cachedAt,
  refreshingLabel,
  offlineLabel,
}: {
  refreshing: boolean;
  offline: boolean;
  cachedAt: number | null;
  refreshingLabel: string;
  offlineLabel: string;
}) {
  if (!refreshing && !offline) return null;

  if (offline && cachedAt) {
    return (
      <Alert variant="warning">
        {offlineLabel.replace("{time}", formatDailyCollectionsCachedAt(cachedAt))}
      </Alert>
    );
  }

  if (refreshing) {
    return <Alert variant="info">{refreshingLabel}</Alert>;
  }

  return null;
}
