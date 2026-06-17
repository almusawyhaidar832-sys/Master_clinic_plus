import {
  OFFLINE_BLOBS_STORE,
  OFFLINE_DB_NAME,
  OFFLINE_DB_VERSION,
  OFFLINE_QUEUE_STORE,
} from "@/lib/offline/types";

function openOfflineDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB غير متاح في هذا المتصفح"));
      return;
    }

    const request = indexedDB.open(OFFLINE_DB_NAME, OFFLINE_DB_VERSION);

    request.onerror = () => {
      reject(request.error ?? new Error("تعذر فتح قاعدة البيانات المحلية"));
    };

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(OFFLINE_QUEUE_STORE)) {
        const store = db.createObjectStore(OFFLINE_QUEUE_STORE, { keyPath: "id" });
        store.createIndex("status", "status", { unique: false });
        store.createIndex("createdAt", "createdAt", { unique: false });
      }
      if (!db.objectStoreNames.contains(OFFLINE_BLOBS_STORE)) {
        db.createObjectStore(OFFLINE_BLOBS_STORE, { keyPath: "id" });
      }
    };

    request.onsuccess = () => resolve(request.result);
  });
}

function txStore(
  storeName: string,
  mode: IDBTransactionMode
): Promise<{ db: IDBDatabase; store: IDBObjectStore }> {
  return openOfflineDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, mode);
        const store = tx.objectStore(storeName);
        tx.oncomplete = () => db.close();
        tx.onerror = () => reject(tx.error);
        resolve({ db, store });
      })
  );
}

export async function idbGet<T>(key: string): Promise<T | null> {
  const { store } = await txStore(OFFLINE_QUEUE_STORE, "readonly");
  return new Promise((resolve, reject) => {
    const req = store.get(key);
    req.onsuccess = () => resolve((req.result as T | undefined) ?? null);
    req.onerror = () => reject(req.error);
  });
}

export async function idbGetAll<T>(storeName = OFFLINE_QUEUE_STORE): Promise<T[]> {
  const { store } = await txStore(storeName, "readonly");
  return new Promise((resolve, reject) => {
    const req = store.getAll();
    req.onsuccess = () => resolve((req.result as T[]) ?? []);
    req.onerror = () => reject(req.error);
  });
}

export async function idbPut<T extends { id: string }>(
  record: T,
  storeName = OFFLINE_QUEUE_STORE
): Promise<void> {
  const { store } = await txStore(storeName, "readwrite");
  return new Promise((resolve, reject) => {
    const req = store.put(record);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function idbDelete(
  key: string,
  storeName = OFFLINE_QUEUE_STORE
): Promise<void> {
  const { store } = await txStore(storeName, "readwrite");
  return new Promise((resolve, reject) => {
    const req = store.delete(key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function idbDeleteMany(
  keys: string[],
  storeName = OFFLINE_QUEUE_STORE
): Promise<void> {
  if (!keys.length) return;
  const { store } = await txStore(storeName, "readwrite");
  await Promise.all(
    keys.map(
      (key) =>
        new Promise<void>((resolve, reject) => {
          const req = store.delete(key);
          req.onsuccess = () => resolve();
          req.onerror = () => reject(req.error);
        })
    )
  );
}
