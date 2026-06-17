import { idbDeleteMany, idbGetAll, idbPut } from "@/lib/offline/idb";
import { OFFLINE_BLOBS_STORE } from "@/lib/offline/types";

export interface OfflineBlobRecord {
  id: string;
  queueItemId: string;
  fileName: string;
  mimeType: string;
  data: ArrayBuffer;
  createdAt: string;
}

function newBlobId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `blob-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export async function storeOfflineBlobs(
  queueItemId: string,
  files: File[]
): Promise<string[]> {
  const ids: string[] = [];
  for (const file of files) {
    const id = newBlobId();
    const record: OfflineBlobRecord = {
      id,
      queueItemId,
      fileName: file.name,
      mimeType: file.type || "application/octet-stream",
      data: await file.arrayBuffer(),
      createdAt: new Date().toISOString(),
    };
    await idbPut(record, OFFLINE_BLOBS_STORE);
    ids.push(id);
  }
  return ids;
}

export async function readOfflineBlobs(
  blobIds: string[]
): Promise<OfflineBlobRecord[]> {
  if (!blobIds.length) return [];
  const all = await idbGetAll<OfflineBlobRecord>(OFFLINE_BLOBS_STORE);
  const set = new Set(blobIds);
  return all.filter((b) => set.has(b.id));
}

export async function deleteOfflineBlobs(blobIds: string[]): Promise<void> {
  await idbDeleteMany(blobIds, OFFLINE_BLOBS_STORE);
}
