import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  isPersistedTreatmentCaseId,
  linkOperationToTreatmentCase,
  resolvePersistedCaseIdFromDb,
} from "@/lib/services/patient-treatment-cases";
import type { PatientOperation } from "@/types";

export type WhatsAppSessionMeta = {
  caseId: string | null;
  sessionNumber: number;
  totalSessionsInCase: number;
  procedureLabel: string;
  remainingBalance: number;
  paidThisSession: number;
  caseFinalPrice: number;
  caseTotalPaid: number;
};

function num(v: unknown): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

/** قراءة المالية من سجل الحالة فقط — لا دمج جلسات قديمة بالاسم */
async function fetchCaseRecordForWhatsApp(
  admin: SupabaseClient,
  caseId: string
): Promise<{
  procedureLabel: string;
  caseFinalPrice: number;
  caseTotalPaid: number;
  remainingBalance: number;
} | null> {
  const { data: row, error } = await admin
    .from("patient_treatment_cases")
    .select(
      "treatment_name_ar, final_price, case_price, discount_total, total_paid, remaining_balance"
    )
    .eq("id", caseId)
    .maybeSingle();

  if (error || !row) return null;

  const r = row as Record<string, unknown>;
  const caseFinalPrice =
    num(r.final_price) ||
    Math.max(0, num(r.case_price) - num(r.discount_total));
  const caseTotalPaid = num(r.total_paid);
  const remainingBalance =
    caseFinalPrice > 0
      ? Math.max(0, caseFinalPrice - caseTotalPaid)
      : Math.max(0, num(r.remaining_balance));

  return {
    procedureLabel: String(r.treatment_name_ar ?? "علاج").trim() || "علاج",
    caseFinalPrice,
    caseTotalPaid,
    remainingBalance,
  };
}

/**
 * حلّ الحالة الحالية فقط — treatment_case_id الممرَّر أو المربوط بالجلسة الحالية.
 * لا تجميع بالاسم ولا ربط جلسات قديمة.
 */
export async function resolveWhatsAppSessionMeta(
  admin: SupabaseClient,
  input: {
    operationId: string;
    patientId: string;
    treatmentCaseId?: string | null;
  }
): Promise<WhatsAppSessionMeta> {
  const { data: opRow } = await admin
    .from("patient_operations")
    .select("id, patient_id, paid_amount, treatment_case_id")
    .eq("id", input.operationId)
    .maybeSingle();

  const currentOp = (opRow ?? null) as PatientOperation | null;
  const paidThisSession = num(currentOp?.paid_amount);

  let caseId: string | null = null;

  const explicitCaseId = input.treatmentCaseId?.trim() || null;
  if (explicitCaseId && isPersistedTreatmentCaseId(explicitCaseId)) {
    caseId = explicitCaseId;
  } else if (explicitCaseId) {
    caseId = await resolvePersistedCaseIdFromDb(
      admin,
      input.patientId,
      explicitCaseId,
      null
    );
  }

  if (!caseId) {
    const linkedOnOp = currentOp?.treatment_case_id?.trim();
    if (linkedOnOp && isPersistedTreatmentCaseId(linkedOnOp)) {
      caseId = linkedOnOp;
    }
  }

  if (!caseId || !isPersistedTreatmentCaseId(caseId)) {
    console.log("[whatsapp] pre-send", {
      caseId: null,
      sessionCountForThisCase: 1,
      currentRemainingBalance: 0,
    });
    return {
      caseId: null,
      sessionNumber: 1,
      totalSessionsInCase: 1,
      procedureLabel: "علاج",
      remainingBalance: 0,
      paidThisSession,
      caseFinalPrice: 0,
      caseTotalPaid: 0,
    };
  }

  await linkOperationToTreatmentCase(admin, input.operationId, caseId);

  const sessionCount = await admin
    .from("patient_operations")
    .select("*", { count: "exact", head: true })
    .eq("treatment_case_id", caseId);

  const sessionNumber = Math.max(1, sessionCount.count ?? 1);
  const totalSessionsInCase = sessionNumber;

  const caseRecord = await fetchCaseRecordForWhatsApp(admin, caseId);

  const procedureLabel = caseRecord?.procedureLabel ?? "علاج";
  const remainingBalance = caseRecord?.remainingBalance ?? 0;
  const caseFinalPrice = caseRecord?.caseFinalPrice ?? 0;
  const caseTotalPaid = caseRecord?.caseTotalPaid ?? 0;

  console.log("[whatsapp] pre-send", {
    caseId,
    sessionCountForThisCase: sessionNumber,
    currentRemainingBalance: remainingBalance,
  });

  return {
    caseId,
    sessionNumber,
    totalSessionsInCase,
    procedureLabel,
    remainingBalance,
    paidThisSession,
    caseFinalPrice,
    caseTotalPaid,
  };
}
