import { isBrowserOffline } from "@/lib/offline/network";
import { enqueueAddPatientOffline } from "@/lib/offline/queue-store";
import { getCachedOfflineReference } from "@/lib/offline/reference-cache";
import {
  validateAddPatientOffline,
  type AddPatientOfflineInput,
} from "@/lib/offline/add-patient/validate";

export type AddPatientOfflineAttemptResult =
  | { handled: false }
  | { handled: true; ok: true; message: string }
  | { handled: true; ok: false; message: string };

export async function tryEnqueueAddPatientOffline(
  input: AddPatientOfflineInput
): Promise<AddPatientOfflineAttemptResult> {
  if (!isBrowserOffline()) {
    return { handled: false };
  }

  const clinicId =
    input.clinicId ?? getCachedOfflineReference()?.clinicId ?? null;

  const validated = validateAddPatientOffline({ ...input, clinicId });
  if (!validated.ok) {
    return { handled: true, ok: false, message: validated.message };
  }

  try {
    await enqueueAddPatientOffline(validated.payload);
    return {
      handled: true,
      ok: true,
      message:
        "تم حفظ المراجع محلياً — سيظهر في القائمة بعد عودة النت والمزامنة التلقائية",
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
