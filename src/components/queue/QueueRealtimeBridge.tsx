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
import {
  listenForPushAlertMessages,
  listenForServiceWorkerNavigation,
} from "@/lib/push/client";
import {
  triggerQueueAlert,
  type QueueAlertKind,
} from "@/lib/queue/audio-alerts";
import { useRouter } from "next/navigation";

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
  const router = useRouter();
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

  /** Push / SW → نداء صوتي عندما التطبيق مفتوح (محاسب / مساعد / طبيب) */
  useEffect(() => {
    return listenForPushAlertMessages((payload) => {
      const rawKind = payload.kind ?? "accountant_admit";
      const kindMap: Record<string, QueueAlertKind> = {
        doctor_queue: "doctor_new",
        doctor_new: "doctor_new",
        doctor_exam: "doctor_exam",
        accountant_admit: "accountant_admit",
        accountant_billing: "accountant_billing",
        accountant_payment: "accountant_billing",
      };
      const kind = kindMap[rawKind] ?? "accountant_admit";

      void triggerQueueAlert({
        kind,
        title: payload.title ?? "تنبيه 🔔",
        message: payload.body ?? "",
        linkPath: payload.url,
        patientName: payload.patientName,
        audioUrl: payload.audioUrl,
        entryId: payload.entryId,
      });
    });
  }, []);

  useEffect(() => {
    return listenForServiceWorkerNavigation((url) => {
      router.push(url);
    });
  }, [router]);

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
