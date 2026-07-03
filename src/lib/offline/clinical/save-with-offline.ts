import type { SessionClinicalDraft } from "@/lib/clinical/constants";
import type { AuthPortalId } from "@/lib/auth/portal-access";
import { saveSessionClinicalRecords } from "@/lib/clinical/session-records";
import { isBrowserOffline, isNetworkFailure } from "@/lib/offline/network";
import { tryEnqueueClinicalRecordOffline } from "@/lib/offline/clinical/enqueue";

export async function saveClinicalWithOfflineFallback(
  operationId: string,
  draft: SessionClinicalDraft,
  portal: AuthPortalId = "doctor",
  clinicId?: string | null
): Promise<{ ok: boolean; error?: string; offline?: boolean }> {
  if (isBrowserOffline()) {
    const attempt = await tryEnqueueClinicalRecordOffline({
      clinicId,
      operationId,
      portal,
      draft,
    });
    if (attempt.handled) {
      return {
        ok: attempt.ok,
        error: attempt.ok ? undefined : attempt.message,
        offline: attempt.ok,
      };
    }
  }

  try {
    const res = await saveSessionClinicalRecords(operationId, draft, portal);
    return { ...res, offline: false };
  } catch (err) {
    if (isNetworkFailure(err)) {
      const attempt = await tryEnqueueClinicalRecordOffline(
        { clinicId, operationId, portal, draft },
        { force: true }
      );
      if (attempt.handled) {
        return {
          ok: attempt.ok,
          error: attempt.ok ? undefined : attempt.message,
          offline: attempt.ok,
        };
      }
    }
    return {
      ok: false,
      error: err instanceof Error ? err.message : "تعذر حفظ السجل",
      offline: false,
    };
  }
}
