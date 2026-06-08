"use client";

import type { AppSupabaseClient } from "@/lib/supabase/app-client";
import {
  clinicQueueChannelName,
  doctorQueueChannelName,
} from "@/lib/queue/realtime-client";

function sendBroadcast(
  supabase: AppSupabaseClient,
  channelName: string,
  event: string,
  payload: Record<string, unknown>
): Promise<void> {
  const channel = supabase.channel(channelName, {
    config: { broadcast: { self: false } },
  });

  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      supabase.removeChannel(channel);
      resolve();
    }, 8000);

    channel.subscribe(async (status) => {
      if (status === "SUBSCRIBED") {
        try {
          await channel.send({ type: "broadcast", event, payload });
          await new Promise((r) => setTimeout(r, 400));
        } catch {
          // ignore
        }
        clearTimeout(timeout);
        supabase.removeChannel(channel);
        resolve();
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        clearTimeout(timeout);
        supabase.removeChannel(channel);
        resolve();
      }
    });
  });
}

export function broadcastPatientSentToDoctor(
  supabase: AppSupabaseClient,
  doctorId: string,
  payload: { name: string; entryId?: string }
) {
  return sendBroadcast(
    supabase,
    doctorQueueChannelName(doctorId),
    "queue_patient_sent",
    payload
  );
}

export function broadcastAdmitRequest(
  supabase: AppSupabaseClient,
  clinicId: string,
  payload: { name: string; entryId?: string }
) {
  return sendBroadcast(
    supabase,
    clinicQueueChannelName(clinicId),
    "queue_admit_request",
    payload
  );
}

/** Tell waiting-room TV to repeat voice announcement */
export function broadcastQueueScreenRecall(
  supabase: AppSupabaseClient,
  clinicId: string,
  payload: { name: string; doctorName: string; entryId?: string }
) {
  return sendBroadcast(
    supabase,
    clinicQueueChannelName(clinicId),
    "queue_screen_recall",
    payload
  );
}
