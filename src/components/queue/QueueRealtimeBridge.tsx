"use client";

import { useEffect, useState } from "react";
import { useClinicProfile } from "@/contexts/ClinicProfileContext";
import {
  getAssistantForCurrentUser,
  getDoctorForCurrentUser,
} from "@/lib/clinic-context";
import { createClient } from "@/lib/supabase/client";
import {
  useAccountantQueuePolling,
  useDoctorQueuePolling,
  fetchDoctorIdForPolling,
} from "@/hooks/useQueuePolling";
import {
  useAccountantQueueRealtime,
  useDoctorQueueRealtime,
} from "@/hooks/useQueueRealtime";
import { ensureNotificationPermission } from "@/lib/queue/realtime-client";
import { QueueAlertOverlay } from "@/components/queue/QueueAlertOverlay";

interface QueueRealtimeBridgeProps {
  portal: "dashboard" | "doctor" | "assistant";
  /** polling — fallback للتحديث فقط؛ النداء من Realtime داخل التطبيق */
  enablePolling?: boolean;
}

/**
 * Queue alerts: Realtime + polling fallback.
 * Doctor portal: mounted globally in DoctorMobileShell (all pages).
 * Assistant portal: admit alerts + sync for linked doctor only.
 */
export function QueueRealtimeBridge({
  portal,
  enablePolling = true,
}: QueueRealtimeBridgeProps) {
  const { profile } = useClinicProfile();
  const clinicId = profile?.id ?? null;
  const [doctorId, setDoctorId] = useState<string | null>(null);

  useEffect(() => {
    if (portal !== "doctor" && portal !== "assistant") return;
    let cancelled = false;

    async function loadDoctorId() {
      const supabase = createClient();

      if (portal === "assistant") {
        const asst = await getAssistantForCurrentUser(supabase);
        if (cancelled) return;
        if (asst?.doctor_id) {
          setDoctorId(asst.doctor_id);
        }
        return;
      }

      const doc = await getDoctorForCurrentUser(supabase);
      if (cancelled) return;
      if (doc?.id) {
        setDoctorId(doc.id);
        return;
      }
      const id = await fetchDoctorIdForPolling();
      if (!cancelled && id) setDoctorId(id);
    }

    void loadDoctorId();

    return () => {
      cancelled = true;
    };
  }, [portal]);

  useEffect(() => {
    if (portal === "doctor") return;
    void ensureNotificationPermission();
  }, [portal]);

  const activeDoctorId =
    portal === "doctor" || portal === "assistant" ? doctorId : null;
  const activeClinicId =
    portal === "dashboard" || portal === "assistant" ? clinicId : null;

  useDoctorQueueRealtime(activeDoctorId, {
    alerts: portal === "doctor",
  });

  useAccountantQueueRealtime(activeClinicId, {
    admitLinkPath:
      portal === "assistant" ? "/assistant/queue" : "/dashboard/queue",
    doctorId: portal === "assistant" ? doctorId ?? undefined : undefined,
  });

  useDoctorQueuePolling(
    portal === "doctor" ? activeDoctorId : null,
    enablePolling && portal === "doctor"
  );

  useAccountantQueuePolling(activeClinicId, enablePolling, {
    admitLinkPath:
      portal === "assistant" ? "/assistant/queue" : "/dashboard/queue",
    doctorId: portal === "assistant" ? doctorId ?? undefined : undefined,
    portal: portal === "assistant" ? "assistant" : "accountant",
  });

  return <QueueAlertOverlay />;
}
