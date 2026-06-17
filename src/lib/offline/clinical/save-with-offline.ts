import type { SessionClinicalDraft } from "@/lib/clinical/constants";
import type { AuthPortalId } from "@/lib/auth/portal-access";
import { saveSessionClinicalRecords } from "@/lib/clinical/session-records";
import { isBrowserOffline } from "@/lib/offline/network";
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

  const res = await saveSessionClinicalRecords(operationId, draft, portal);
  return { ...res, offline: false };
}
