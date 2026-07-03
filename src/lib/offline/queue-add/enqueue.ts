import { shouldEnqueueOffline, type OfflineEnqueueOptions } from "@/lib/offline/enqueue-guard";
import { enqueueQueueAddOffline } from "@/lib/offline/queue-store";
import { getCachedOfflineReference } from "@/lib/offline/reference-cache";
import {
  validateQueueAddOffline,
  type QueueAddOfflineInput,
} from "@/lib/offline/queue-add/validate";

export type QueueAddOfflineAttemptResult =
  | { handled: false }
  | { handled: true; ok: true; message: string }
  | { handled: true; ok: false; message: string };

export async function tryEnqueueQueueAddOffline(
  input: QueueAddOfflineInput,
  options?: OfflineEnqueueOptions
): Promise<QueueAddOfflineAttemptResult> {
  if (!shouldEnqueueOffline(options)) {
    return { handled: false };
  }

  const clinicId =
    input.clinicId ?? getCachedOfflineReference()?.clinicId ?? null;

  const validated = validateQueueAddOffline({ ...input, clinicId });
  if (!validated.ok) {
    return { handled: true, ok: false, message: validated.message };
  }

  try {
    await enqueueQueueAddOffline(validated.payload);
    return {
      handled: true,
      ok: true,
      message:
        "تمت إضافة المراجع للطابور محلياً — سيُرفع تلقائياً عند عودة النت",
    };
  } catch (err) {
    return {
      handled: true,
      ok: false,
      message:
        err instanceof Error
          ? `تعذر الحفظ المحلي: ${err.message}`
          : "تعذر الحفظ المحلي",
    };
  }
}
