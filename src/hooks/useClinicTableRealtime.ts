"use client";

import { useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  notifyClinicSync,
  type ClinicSyncTopic,
} from "@/lib/sync/clinic-events";

type RealtimeTable =
  | "patient_operations"
  | "session_refunds"
  | "audit_logs"
  | "appointments";

const TABLE_TOPICS: Record<RealtimeTable, ClinicSyncTopic[]> = {
  patient_operations: ["sessions", "profit"],
  session_refunds: ["refunds", "sessions", "profit"],
  audit_logs: ["audit"],
  appointments: ["appointments"],
};

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
        () => {
          notifyClinicSync({
            topic: topics,
            clinicId,
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
