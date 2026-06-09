"use client";

/**
 * Global clinic sync event bus — أي تغيّر في البيانات يُبث لكل الصفحات المفتوحة.
 * يعمل مع Supabase Realtime (ClinicDataSyncBridge) ومع إشارات العميل بعد POST/PUT/DELETE.
 */

export type ClinicSyncTopic =
  | "all"
  | "queue"
  | "appointments"
  | "sessions"
  | "refunds"
  | "audit"
  | "profit"
  | "notifications";

export type ClinicSyncSource = "mutation" | "realtime" | "manual" | "polling";

export interface ClinicSyncDetail {
  topic: ClinicSyncTopic | ClinicSyncTopic[];
  clinicId?: string;
  doctorId?: string;
  patientId?: string;
  /** تجاوز فلاتر النطاق — يُستخدم مع التحديث العام */
  force?: boolean;
  source?: ClinicSyncSource;
}

const CLINIC_SYNC_EVENT = "master-clinic-sync";

function normalizeTopics(
  topic: ClinicSyncTopic | ClinicSyncTopic[]
): ClinicSyncTopic[] {
  return Array.isArray(topic) ? topic : [topic];
}

/** إشعار مركزي — يُستدعى بعد نجاح أي عملية أو عند وصول حدث Realtime */
export function notifyClinicSync(detail: ClinicSyncDetail): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(CLINIC_SYNC_EVENT, { detail }));
}

/** إعادة مزامنة شاملة لكل القوائم (زر المدير) */
export function forceGlobalResync(clinicId: string): void {
  notifyClinicSync({
    topic: "all",
    clinicId,
    force: true,
    source: "manual",
  });
}

export interface ClinicSyncSubscribeOptions {
  topics: ClinicSyncTopic[];
  clinicId?: string | null;
  doctorId?: string | null;
  patientId?: string | null;
}

function topicMatches(
  detailTopics: ClinicSyncTopic[],
  subscribed: ClinicSyncTopic[]
): boolean {
  if (detailTopics.includes("all")) return true;
  if (subscribed.includes("all")) return true;
  return detailTopics.some((t) => subscribed.includes(t));
}

function scopeMatches(
  detail: ClinicSyncDetail,
  filter: ClinicSyncSubscribeOptions
): boolean {
  if (detail.force) return true;
  if (detail.clinicId && filter.clinicId && detail.clinicId !== filter.clinicId) {
    return false;
  }
  if (detail.doctorId && filter.doctorId && detail.doctorId !== filter.doctorId) {
    return false;
  }
  if (detail.patientId && filter.patientId && detail.patientId !== filter.patientId) {
    return false;
  }
  return true;
}

/** اشتراك في حافلة المزامنة — يُرجع دالة إلغاء الاشتراك */
export function subscribeClinicSync(
  handler: (detail: ClinicSyncDetail) => void,
  options: ClinicSyncSubscribeOptions
): () => void {
  if (typeof window === "undefined") return () => {};

  const listener = (event: Event) => {
    const detail = (event as CustomEvent<ClinicSyncDetail>).detail;
    const detailTopics = normalizeTopics(detail.topic);
    if (!topicMatches(detailTopics, options.topics)) return;
    if (!scopeMatches(detail, options)) return;
    handler(detail);
  };

  window.addEventListener(CLINIC_SYNC_EVENT, listener);
  return () => window.removeEventListener(CLINIC_SYNC_EVENT, listener);
}
