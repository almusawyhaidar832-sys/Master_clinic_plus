import "server-only";

import { getAdminClient } from "@/lib/supabase/admin";
import {
  clinicQueueChannelName,
  clinicQueueScreenChannelName,
  doctorQueueChannelName,
} from "@/lib/queue/realtime-channels";
import type { PatientGender } from "@/lib/queue/patient-gender";
import type { QueueScreenSyncPayload } from "@/lib/queue/broadcast-types";

export type { QueueScreenSyncPayload, QueueScreenSyncRow } from "@/lib/queue/broadcast-types";

export type QueueScreenCallPayload = {
  name: string;
  doctorName: string;
  entryId?: string;
  ticketNumber?: number;
  gender?: PatientGender;
  recall?: boolean;
  /** MP3 موقّع من السيرفر — يعمل على TV بدون جلسة */
  audioUrl?: string;
};

export type QueuePatientSentPayload = {
  name: string;
  entryId?: string;
  recall?: boolean;
  sentAt?: string;
  notes?: string;
};

export type QueueAdmitPayload = {
  name: string;
  entryId?: string;
  gender?: PatientGender;
  audioUrl?: string;
};

function sendServerBroadcast(
  channelName: string,
  event: string,
  payload: Record<string, unknown>
): Promise<void> {
  const supabase = getAdminClient();

  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      void supabase.removeChannel(channel);
      resolve();
    }, 2000);

    const channel = supabase.channel(channelName, {
      config: { broadcast: { ack: false, self: false } },
    });

    channel.subscribe((status) => {
      if (status === "SUBSCRIBED") {
        void channel
          .send({ type: "broadcast", event, payload })
          .catch((err) => {
            console.error("[queue-broadcast] send failed:", event, err);
          })
          .finally(() => {
            clearTimeout(timeout);
            void supabase.removeChannel(channel);
            resolve();
          });
        return;
      }

      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        clearTimeout(timeout);
        void supabase.removeChannel(channel);
        resolve();
      }
    });
  });
}

/** بث فوري من السيرفر — لا ينتظر متصفح المحاسب/الطبيب */
export function broadcastPatientSentToDoctorServer(
  doctorId: string,
  payload: QueuePatientSentPayload
): Promise<void> {
  return sendServerBroadcast(
    doctorQueueChannelName(doctorId),
    "queue_patient_sent",
    payload as Record<string, unknown>
  );
}

export function broadcastAdmitRequestServer(
  clinicId: string,
  payload: QueueAdmitPayload
): Promise<void> {
  return sendServerBroadcast(
    clinicQueueChannelName(clinicId),
    "queue_admit_request",
    payload as Record<string, unknown>
  );
}

export function broadcastQueueScreenCallServer(
  clinicId: string,
  payload: QueueScreenCallPayload
): Promise<void> {
  return sendServerBroadcast(
    clinicQueueScreenChannelName(clinicId),
    "queue_screen_call",
    payload as Record<string, unknown>
  );
}

/** تحديث قائمة شاشة الانتظار — يعمل على التلفاز بدون جلسة (broadcast وليس postgres_changes) */
export function broadcastQueueScreenSyncServer(
  clinicId: string,
  payload: QueueScreenSyncPayload
): Promise<void> {
  return sendServerBroadcast(
    clinicQueueScreenChannelName(clinicId),
    "queue_screen_sync",
    payload as Record<string, unknown>
  );
}

export function broadcastBillingReadyServer(
  clinicId: string,
  payload: {
    name: string;
    entryId: string;
    linkPath: string;
    gender?: PatientGender;
    doctorNotes?: string;
    audioUrl?: string;
  }
): Promise<void> {
  return sendServerBroadcast(
    clinicQueueChannelName(clinicId),
    "queue_billing_ready",
    payload as Record<string, unknown>
  );
}
