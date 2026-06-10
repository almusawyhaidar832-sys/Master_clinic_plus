"use client";

import { useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  notifyClinicSync,
  type ClinicSyncTopic,
} from "@/lib/sync/clinic-events";
import type { RealtimePostgresChangesPayload } from "@supabase/supabase-js";

type RealtimeTable =
  | "patient_operations"
  | "session_refunds"
  | "audit_logs"
  | "appointments"
  | "invoices_history"
  | "doctor_withdrawals"
  | "transactions"
  | "doctor_expenses";

const TABLE_TOPICS: Record<RealtimeTable, ClinicSyncTopic[]> = {
  patient_operations: ["sessions", "financial"],
  session_refunds: ["refunds", "sessions", "financial"],
  audit_logs: ["audit"],
  appointments: ["appointments"],
  invoices_history: ["financial", "sessions"],
  doctor_withdrawals: ["financial"],
  transactions: ["financial", "profit"],
  doctor_expenses: ["financial"],
};

function rowDoctorId(payload: RealtimePostgresChangesPayload<Record<string, unknown>>): string | undefined {
  const row = (payload.new ?? payload.old) as Record<string, unknown> | null;
  const id = row?.doctor_id;
  return id != null && id !== "" ? String(id) : undefined;
}

function rowPatientId(payload: RealtimePostgresChangesPayload<Record<string, unknown>>): string | undefined {
  const row = (payload.new ?? payload.old) as Record<string, unknown> | null;
  const id = row?.patient_id;
  return id != null && id !== "" ? String(id) : undefined;
}

/**
 * اشتراك Supabase Realtime لجدول واحد — يُبث عبر حافلة المزامنة المركزية.
 */
export function useClinicTableRealtime(
  table: RealtimeTable,
  clinicId: string | null | undefined
): void {
  useEffect(() => {
    if (!clinicId) return;

    const supabase = createClient();
    const channelName = `sync-${table}-${clinicId}`;
    const topics = TABLE_TOPICS[table];

    const channel = supabase
      .channel(channelName)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table,
          filter: `clinic_id=eq.${clinicId}`,
        },
        (payload) => {
          notifyClinicSync({
            topic: topics,
            clinicId,
            doctorId: rowDoctorId(payload),
            patientId: rowPatientId(payload),
            source: "realtime",
          });
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [table, clinicId]);
}
