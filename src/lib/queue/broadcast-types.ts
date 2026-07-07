/** أنواع بث شاشة الانتظار — مشتركة بين السيرفر والعميل */

export type QueueScreenSyncRow = {
  id: string;
  ticket_number: number;
  status: string;
  patient_name: string | null;
  doctor_id: string;
  queue_date: string;
  called_at: string | null;
  cancellation_requested_at?: string | null;
  doctor?: { full_name_ar: string } | null;
  patient?: {
    full_name_ar: string;
    speech_name_ar?: string | null;
    gender?: string | null;
  } | null;
};

export type QueueScreenSyncPayload = {
  event: "upsert" | "delete";
  row?: QueueScreenSyncRow;
  entryId?: string;
};
