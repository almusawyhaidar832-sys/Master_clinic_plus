"use client";

import { useEffect, useRef } from "react";
import type { Dispatch, SetStateAction } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  clinicQueueListChannelName,
  doctorQueueListChannelName,
} from "@/lib/queue/realtime-client";
import {
  patchQueueListFromRealtime,
  type QueueRealtimePayload,
} from "@/lib/queue/realtime-patch";

type DoctorLookup = { id: string; full_name_ar: string };

export interface QueueRealtimeSyncOptions<T extends { id: string; ticket_number: number }> {
  doctors?: DoctorLookup[];
  doctorId?: string;
  includeRow?: (row: Record<string, unknown>) => boolean;
  onChange?: (payload: QueueRealtimePayload, nextQueue: T[]) => void;
}

/**
 * Subscribe to patient_queue changes and patch local state — zero API polling/refetch.
 */
export function useQueueRealtimeSync<T extends { id: string; ticket_number: number }>(
  scope: "clinic" | "doctor",
  scopeId: string | null | undefined,
  setQueue: Dispatch<SetStateAction<T[]>>,
  options?: QueueRealtimeSyncOptions<T>
) {
  const optionsRef = useRef(options);
  optionsRef.current = options;

  useEffect(() => {
    if (!scopeId) return;

    const supabase = createClient();
    const channelName =
      scope === "doctor"
        ? doctorQueueListChannelName(scopeId)
        : clinicQueueListChannelName(scopeId);
    const pgFilter =
      scope === "doctor"
        ? `doctor_id=eq.${scopeId}`
        : `clinic_id=eq.${scopeId}`;

    const channel = supabase
      .channel(channelName)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "patient_queue",
          filter: pgFilter,
        },
        (payload) => {
          const typed = payload as QueueRealtimePayload;
          setQueue((current) => {
            const next = patchQueueListFromRealtime(current, typed, {
              doctors: optionsRef.current?.doctors,
              doctorId: optionsRef.current?.doctorId ?? (scope === "doctor" ? scopeId : undefined),
              includeRow: optionsRef.current?.includeRow,
            });
            optionsRef.current?.onChange?.(typed, next);
            return next;
          });
        }
      )
      .subscribe((status) => {
        if (status === "CHANNEL_ERROR") {
          console.warn("[queue] list realtime channel error", channelName);
        }
      });

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [scope, scopeId, setQueue]);
}
