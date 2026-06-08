"use client";

import { useEffect } from "react";
import { createClient } from "@/lib/supabase/client";

/** اشتراك Realtime لمواعيد العيادة — يُحدّث القائمة فوراً */
export function useAppointmentsRealtime(
  clinicId: string | null | undefined,
  onRefresh: () => void
) {
  useEffect(() => {
    if (!clinicId) return;

    const supabase = createClient();
    const channelName = `appointments-clinic-${clinicId}`;

    const channel = supabase
      .channel(channelName)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "appointments",
          filter: `clinic_id=eq.${clinicId}`,
        },
        () => {
          onRefresh();
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [clinicId, onRefresh]);
}
