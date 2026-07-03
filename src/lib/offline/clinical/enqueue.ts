import type { SessionClinicalDraft } from "@/lib/clinical/constants";
import type { AuthPortalId } from "@/lib/auth/portal-access";
import { teethFromDraft } from "@/lib/clinical/session-records";
import { shouldEnqueueOffline, type OfflineEnqueueOptions } from "@/lib/offline/enqueue-guard";
import { enqueueClinicalRecordOffline } from "@/lib/offline/queue-store";
import { getCachedOfflineReference } from "@/lib/offline/reference-cache";

export type ClinicalOfflineAttemptResult =
  | { handled: false }
  | { handled: true; ok: true; message: string }
  | { handled: true; ok: false; message: string };

export async function tryEnqueueClinicalRecordOffline(input: {
  clinicId?: string | null;
  operationId: string;
  portal: AuthPortalId;
  draft: SessionClinicalDraft;
}, options?: OfflineEnqueueOptions): Promise<ClinicalOfflineAttemptResult> {
  if (!shouldEnqueueOffline(options)) {
    return { handled: false };
  }

  const clinicId =
    input.clinicId ?? getCachedOfflineReference()?.clinicId ?? null;
  if (!clinicId) {
    return {
      handled: true,
      ok: false,
      message:
        "لا يمكن الحفظ بدون نت — افتح النظام مرة مع اتصال لتحميل بيانات العيادة",
    };
  }

  const teeth = teethFromDraft(input.draft);
  const hasXrays = input.draft.xrayFiles.length > 0;
  if (!teeth.length && !hasXrays) {
    return {
      handled: true,
      ok: false,
      message: "أضف صورة أشعة أو حدّد سنّاً على المخطط",
    };
  }

  try {
    await enqueueClinicalRecordOffline({
      clinicId,
      operationId: input.operationId,
      portal: input.portal,
      draft: input.draft,
    });
    return {
      handled: true,
      ok: true,
      message:
        "تم حفظ السجل السريري محلياً — سيُرفع تلقائياً عند عودة النت",
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
