import type { SessionClinicalDraft, ToothRecordInput } from "@/lib/clinical/constants";
import { authPortalHeaders } from "@/lib/auth/api-portal";
import { teethPayloadFromDraft } from "@/lib/clinical/dental-chart-logic";

export async function saveSessionClinicalRecords(
  operationId: string,
  draft: SessionClinicalDraft
): Promise<{ ok: boolean; error?: string }> {
  const teeth = teethPayloadFromDraft(draft.teeth);
  const portalHeaders = authPortalHeaders("accountant");

  if (teeth.length > 0) {
    const res = await fetch("/api/clinical/session-records", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...portalHeaders,
      },
      credentials: "same-origin",
      body: JSON.stringify({ operation_id: operationId, teeth }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      const errMsg = (json as { error?: string }).error || "تعذر حفظ مخطط الأسنان";
      const friendly =
        errMsg.includes("operation_tooth_records") ||
        errMsg.includes("schema cache")
          ? "جدول السجل الطبي غير موجود — شغّل SQL: supabase/scripts/fix-clinical-session-records.sql"
          : errMsg;
      return { ok: false, error: friendly };
    }
  }

  for (const file of draft.xrayFiles) {
    const form = new FormData();
    form.append("operation_id", operationId);
    form.append("file", file);

    const res = await fetch("/api/clinical/xray-upload", {
      method: "POST",
      credentials: "same-origin",
      headers: portalHeaders,
      body: form,
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      return {
        ok: false,
        error: (json as { error?: string }).error || "تعذر رفع صورة الأشعة",
      };
    }
  }

  return { ok: true };
}

export function teethFromDraft(
  draft: SessionClinicalDraft
): ToothRecordInput[] {
  return teethPayloadFromDraft(draft.teeth);
}
