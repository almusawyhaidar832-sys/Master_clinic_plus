import { authPortalHeaders } from "@/lib/auth/api-portal";
import type { AuthPortalId } from "@/lib/auth/portal-access";
import { isBrowserOffline } from "@/lib/offline/network";
import {
  deleteOfflineBlobs,
  readOfflineBlobs,
} from "@/lib/offline/blob-store";
import {
  listOfflineQueue,
  removeOfflineQueueItem,
  updateOfflineQueueStatus,
} from "@/lib/offline/queue-store";
import type { OfflineQueueRecord } from "@/lib/offline/types";

let syncInFlight = false;
const lastFailedAttemptAt = new Map<string, number>();
const FAILED_RETRY_DELAY_MS = 30_000;

type SyncPortal = AuthPortalId;

const SYNC_ROUTES: Record<
  OfflineQueueRecord["type"],
  { path: string; portal: SyncPortal; multipart?: boolean }
> = {
  quick_entry: { path: "/api/offline/sync/quick-entry", portal: "accountant" },
  add_patient: { path: "/api/offline/sync/add-patient", portal: "accountant" },
  queue_add: { path: "/api/offline/sync/queue-add", portal: "accountant" },
  clinical_record: {
    path: "/api/offline/sync/clinical-record",
    portal: "doctor",
    multipart: true,
  },
  prescription_save: {
    path: "/api/offline/sync/prescription",
    portal: "doctor",
  },
};

export async function runOfflineSync(): Promise<{
  synced: number;
  failed: number;
}> {
  if (typeof window === "undefined") return { synced: 0, failed: 0 };
  if (isBrowserOffline() || syncInFlight) return { synced: 0, failed: 0 };

  syncInFlight = true;
  let synced = 0;
  let failed = 0;

  try {
    const queue = await listOfflineQueue();
    const now = Date.now();
    const pending = queue.filter((item) => {
      if (item.status === "pending") return true;
      if (item.status !== "failed") return false;
      const last = lastFailedAttemptAt.get(item.id) ?? 0;
      return now - last >= FAILED_RETRY_DELAY_MS;
    });

    for (const item of pending) {
      const ok = await syncOneItem(item);
      if (ok) synced += 1;
      else failed += 1;
    }
  } finally {
    syncInFlight = false;
  }

  return { synced, failed };
}

async function syncOneItem(item: OfflineQueueRecord): Promise<boolean> {
  const route = SYNC_ROUTES[item.type];
  if (!route) return false;

  const portal =
    item.type === "clinical_record"
      ? item.payload.portal
      : item.type === "prescription_save"
        ? item.payload.portal
        : route.portal;

  await updateOfflineQueueStatus(item.id, "syncing");

  try {
    let res: Response;

    if (route.multipart && item.type === "clinical_record") {
      const blobs = await readOfflineBlobs(item.payload.xrayBlobIds);
      const form = new FormData();
      form.append(
        "payload",
        JSON.stringify({ queueId: item.id, payload: item.payload })
      );
      for (const blob of blobs) {
        form.append(
          "files",
          new Blob([blob.data], { type: blob.mimeType }),
          blob.fileName
        );
      }
      res = await fetch(route.path, {
        method: "POST",
        credentials: "include",
        headers: authPortalHeaders(portal),
        body: form,
      });
    } else {
      res = await fetch(route.path, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          ...authPortalHeaders(portal),
        },
        body: JSON.stringify({
          queueId: item.id,
          payload: item.payload,
        }),
      });
    }

    const data = (await res.json()) as { ok?: boolean; error?: string };

    if (!res.ok || !data.ok) {
      lastFailedAttemptAt.set(item.id, Date.now());
      await updateOfflineQueueStatus(
        item.id,
        "failed",
        data.error ?? `HTTP ${res.status}`
      );
      return false;
    }

    if (item.type === "clinical_record" && item.payload.xrayBlobIds.length > 0) {
      await deleteOfflineBlobs(item.payload.xrayBlobIds);
    }

    await removeOfflineQueueItem(item.id);
    lastFailedAttemptAt.delete(item.id);
    return true;
  } catch (err) {
    lastFailedAttemptAt.set(item.id, Date.now());
    await updateOfflineQueueStatus(
      item.id,
      "failed",
      err instanceof Error ? err.message : "تعذر الاتصال"
    );
    return false;
  }
}
