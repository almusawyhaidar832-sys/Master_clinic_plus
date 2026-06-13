"use client";

import { useClinicProfile } from "@/contexts/ClinicProfileContext";
import { useClinicTableRealtime } from "@/hooks/useClinicTableRealtime";
import type { AuthPortalId } from "@/lib/auth/portal-access";

function FinancialSyncTables({ clinicId }: { clinicId: string | null }) {
  useClinicTableRealtime("session_refunds", clinicId);
  useClinicTableRealtime("invoices_history", clinicId);
  useClinicTableRealtime("doctor_withdrawals", clinicId);
  useClinicTableRealtime("transactions", clinicId);
  useClinicTableRealtime("doctor_expenses", clinicId);
  return null;
}

/**
 * جسر المزامنة اللحظية — يستمع لجداول Supabase ويُبث عبر الحافلة المركزية.
 * المساعد: بدون جداول مالية حساسة.
 */
export function ClinicDataSyncBridge({
  portal,
}: {
  portal?: AuthPortalId;
} = {}) {
  const { profile } = useClinicProfile();
  const clinicId = profile?.id ?? null;
  const isAssistant = portal === "assistant";

  useClinicTableRealtime("patient_operations", clinicId);
  useClinicTableRealtime("appointments", clinicId);
  useClinicTableRealtime("audit_logs", clinicId);

  if (!isAssistant) {
    return <FinancialSyncTables clinicId={clinicId} />;
  }

  return null;
}
