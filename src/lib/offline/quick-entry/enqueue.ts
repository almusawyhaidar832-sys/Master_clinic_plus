import { isBrowserOffline } from "@/lib/offline/network";
import { enqueueQuickEntryOffline } from "@/lib/offline/queue-store";
import { getCachedOfflineReference } from "@/lib/offline/reference-cache";
import {
  validateQuickEntryOffline,
  type QuickEntryOfflineInput,
} from "@/lib/offline/quick-entry/validate";

export type QuickEntryOfflineAttemptResult =
  | { handled: false }
  | { handled: true; ok: true; message: string }
  | { handled: true; ok: false; message: string };

/**
 * عند انقطاع النت: يحفظ إدخال المحاسب في IndexedDB للمزامنة لاحقاً.
 * عند وجود نت يُرجع handled:false ويستمر المسار العادي دون تغيير.
 */
export async function tryEnqueueQuickEntryOffline(
  input: QuickEntryOfflineInput
): Promise<QuickEntryOfflineAttemptResult> {
  if (!isBrowserOffline()) {
    return { handled: false };
  }

  const clinicId =
    input.clinicId ?? getCachedOfflineReference()?.clinicId ?? null;

  const validated = validateQuickEntryOffline({ ...input, clinicId });
  if (!validated.ok) {
    return { handled: true, ok: false, message: validated.message };
  }

  try {
    await enqueueQuickEntryOffline(validated.payload);
    return {
      handled: true,
      ok: true,
      message:
        "تم الحفظ محلياً بدون نت — سيُرفع تلقائياً إلى السيرفر عند عودة الاتصال",
    };
  } catch (err) {
    return {
      handled: true,
      ok: false,
      message:
        err instanceof Error
          ? `تعذر الحفظ المحلي: ${err.message}`
          : "تعذر الحفظ المحلي — تحقق من مساحة المتصفح",
    };
  }
}
