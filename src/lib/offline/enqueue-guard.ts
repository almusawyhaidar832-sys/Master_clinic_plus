import { isBrowserOffline } from "@/lib/offline/network";

export type OfflineEnqueueOptions = {
  /** حفظ محلي حتى لو المتصفح يعتقد أن النت متاح (فشل اتصال مؤقت) */
  force?: boolean;
};

export function shouldEnqueueOffline(options?: OfflineEnqueueOptions): boolean {
  return options?.force === true || isBrowserOffline();
}
