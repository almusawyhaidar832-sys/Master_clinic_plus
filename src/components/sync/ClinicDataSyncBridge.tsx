"use client";

import { useClinicProfile } from "@/contexts/ClinicProfileContext";
import { useClinicTableRealtime } from "@/hooks/useClinicTableRealtime";

/**
 * جسر المزامنة اللحظية — يستمع لجداول Supabase ويُبث عبر الحافلة المركزية.
 * يُركّب في تخطيطات dashboard / doctor / assistant.
 */
export function ClinicDataSyncBridge() {
  const { profile } = useClinicProfile();
  const clinicId = profile?.id ?? null;

  useClinicTableRealtime("patient_operations", clinicId);
  useClinicTableRealtime("session_refunds", clinicId);
  useClinicTableRealtime("audit_logs", clinicId);
  useClinicTableRealtime("appointments", clinicId);
  useClinicTableRealtime("invoices_history", clinicId);
  useClinicTableRealtime("doctor_withdrawals", clinicId);
  useClinicTableRealtime("transactions", clinicId);
  useClinicTableRealtime("doctor_expenses", clinicId);

  return null;
}
