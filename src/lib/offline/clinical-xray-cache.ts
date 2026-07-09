import type { ClinicalByOperationId, ClinicalXrayImage } from "@/lib/clinical/types";
import { idbGet, idbPut } from "@/lib/offline/idb";
import { OFFLINE_BLOBS_STORE } from "@/lib/offline/types";
import { isBrowserOffline } from "@/lib/offline/network";

const XRAY_ID_PREFIX = "clinical-xray:";
const MAX_XRAY_BYTES = 5 * 1024 * 1024;
const MAX_XRAYS_PER_PATIENT = 48;
const XRAY_FETCH_CONCURRENCY = 3;

type ClinicalXrayBlobRecord = {
  id: string;
  queueItemId: string;
  fileName: string;
  mimeType: string;
  data: ArrayBuffer;
  createdAt: string;
};

function xrayBlobId(patientId: string, xrayId: string): string {
  return `${XRAY_ID_PREFIX}${patientId}:${xrayId}`;
}

function collectXrays(
  clinicalByOp: ClinicalByOperationId
): ClinicalXrayImage[] {
  const items: ClinicalXrayImage[] = [];
  for (const data of Object.values(clinicalByOp)) {
    for (const xray of data?.xrays ?? []) {
      if (xray.url?.trim() && !xray.url.startsWith("blob:")) items.push(xray);
    }
  }
  return items;
}

async function runWithConcurrency<T>(
  items: T[],
  worker: (item: T) => Promise<void>,
  limit: number
): Promise<void> {
  let index = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) {
      const current = items[index];
      index += 1;
      await worker(current);
    }
  });
  await Promise.all(runners);
}

async function xrayAlreadyCached(
  patientId: string,
  xrayId: string
): Promise<boolean> {
  const record = await idbGet<ClinicalXrayBlobRecord>(
    xrayBlobId(patientId, xrayId),
    OFFLINE_BLOBS_STORE
  );
  return Boolean(record?.data);
}

export async function cacheXraysForClinicalData(
  patientId: string,
  clinicalByOp: ClinicalByOperationId
): Promise<void> {
  if (typeof window === "undefined" || !patientId || isBrowserOffline()) return;
  const xrays = collectXrays(clinicalByOp).slice(0, MAX_XRAYS_PER_PATIENT);

  await runWithConcurrency(
    xrays,
    async (xray) => {
      try {
        if (await xrayAlreadyCached(patientId, xray.id)) return;
        const res = await fetch(xray.url, { credentials: "include" });
        if (!res.ok) return;
        const buffer = await res.arrayBuffer();
        if (buffer.byteLength > MAX_XRAY_BYTES) return;
        const record: ClinicalXrayBlobRecord = {
          id: xrayBlobId(patientId, xray.id),
          queueItemId: patientId,
          fileName: xray.file_name ?? `xray-${xray.id}`,
          mimeType:
            xray.mime_type ?? res.headers.get("content-type") ?? "image/jpeg",
          data: buffer,
          createdAt: new Date().toISOString(),
        };
        await idbPut(record, OFFLINE_BLOBS_STORE);
      } catch {
        /* skip failed xray */
      }
    },
    XRAY_FETCH_CONCURRENCY
  );
}

async function cachedXrayObjectUrl(
  patientId: string,
  xrayId: string
): Promise<string | null> {
  const record = await idbGet<ClinicalXrayBlobRecord>(
    xrayBlobId(patientId, xrayId),
    OFFLINE_BLOBS_STORE
  );
  if (!record?.data) return null;
  const blob = new Blob([record.data], {
    type: record.mimeType || "image/jpeg",
  });
  return URL.createObjectURL(blob);
}

export async function hydrateClinicalWithCachedXrays(
  patientId: string,
  clinicalByOp: ClinicalByOperationId
): Promise<ClinicalByOperationId> {
  if (!patientId || !clinicalByOp || typeof window === "undefined") {
    return clinicalByOp;
  }

  const next: ClinicalByOperationId = {};
  for (const [operationId, data] of Object.entries(clinicalByOp)) {
    if (!data) continue;
    const xrays = await Promise.all(
      (data.xrays ?? []).map(async (xray) => {
        const cachedUrl = await cachedXrayObjectUrl(patientId, xray.id);
        if (cachedUrl) return { ...xray, url: cachedUrl };
        if (isBrowserOffline()) return { ...xray, url: "" };
        return xray;
      })
    );
    next[operationId] = { ...data, xrays };
  }
  return next;
}
