"use client";

import { useEffect, useState } from "react";
import { useClinicProfile } from "@/contexts/ClinicProfileContext";
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
}

/**
 * Queue alerts: polling (always works) + Supabase Realtime (when enabled).
 * Mount in dashboard + doctor layouts so alerts work on every page.
 */
export function QueueRealtimeBridge({ portal }: QueueRealtimeBridgeProps) {
  const { profile } = useClinicProfile();
  const clinicId = profile?.id ?? null;
  const [doctorId, setDoctorId] = useState<string | null>(null);

  useEffect(() => {
    if (portal !== "doctor") return;
    let cancelled = false;

    async function loadDoctorId() {
      const id = await fetchDoctorIdForPolling();
      if (!cancelled) setDoctorId(id);
    }

    void loadDoctorId();
    const retry = setInterval(loadDoctorId, 30_000);

    return () => {
      cancelled = true;
      clearInterval(retry);
    };
  }, [portal]);

  useEffect(() => {
    void ensureNotificationPermission();
  }, []);

  const activeDoctorId = portal === "doctor" ? doctorId : null;
  const activeClinicId = portal === "dashboard" ? clinicId : null;

  useDoctorQueueRealtime(activeDoctorId);
  useAccountantQueueRealtime(activeClinicId);
  useDoctorQueuePolling(activeDoctorId);
  useAccountantQueuePolling(activeClinicId);

  return <QueueAlertOverlay />;
}
