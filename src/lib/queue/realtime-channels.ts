/** أسماء قنوات Supabase Realtime — آمن للسيرفر والعميل */

export function doctorQueueChannelName(doctorId: string) {
  return `queue-doctor-${doctorId}`;
}

export function clinicQueueChannelName(clinicId: string) {
  return `queue-clinic-${clinicId}`;
}

export function doctorQueueListChannelName(doctorId: string) {
  return `queue-doctor-list-${doctorId}`;
}

export function clinicQueueListChannelName(clinicId: string) {
  return `queue-clinic-list-${clinicId}`;
}

export function clinicQueueScreenChannelName(clinicId: string) {
  return `queue-screen-${clinicId}`;
}
