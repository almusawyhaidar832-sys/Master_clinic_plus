"use client";

import { useEffect, useState } from "react";
import { useClinicProfile } from "@/contexts/ClinicProfileContext";
import { getDoctorForCurrentUser } from "@/lib/clinic-context";
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
  portal: "dashboard" | "doctor";
  /** polling — fallback للتحديث فقط؛ النداء من Realtime داخل التطبيق */
  enablePolling?: boolean;
}

/**
 * Queue alerts: Realtime + polling fallback.
 * Doctor portal: mounted globally in DoctorMobileShell (all pages).
 */
export function QueueRealtimeBridge({
  portal,
  enablePolling = true,
}: QueueRealtimeBridgeProps) {
  const { profile } = useClinicProfile();
  const clinicId = profile?.id ?? null;
  const [doctorId, setDoctorId] = useState<string | null>(null);

  useEffect(() => {
    if (portal !== "doctor") return;
    let cancelled = false;

    async function loadDoctorId() {
      const supabase = createClient();
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

  const activeDoctorId = portal === "doctor" ? doctorId : null;
  const activeClinicId = portal === "dashboard" ? clinicId : null;

  useDoctorQueueRealtime(activeDoctorId);
  useAccountantQueueRealtime(activeClinicId);
  useDoctorQueuePolling(activeDoctorId, enablePolling);
  useAccountantQueuePolling(activeClinicId, enablePolling);

  return <QueueAlertOverlay />;
}
