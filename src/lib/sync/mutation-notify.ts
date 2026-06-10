"use client";

import {
  notifyClinicSync,
  type ClinicSyncTopic,
} from "@/lib/sync/clinic-events";

/** بعد إنشاء/تعديل جلسة */
export function notifySessionMutation(input: {
  clinicId: string;
  doctorId?: string;
  patientId?: string;
}): void {
  notifyClinicSync({
    topic: ["sessions", "financial"],
    clinicId: input.clinicId,
    doctorId: input.doctorId,
    patientId: input.patientId,
    source: "mutation",
  });
}

/** بعد تسجيل مرتجع */
export function notifyRefundMutation(input: {
  clinicId: string;
  doctorId?: string;
  patientId?: string;
}): void {
  notifyClinicSync({
    topic: ["refunds", "sessions", "financial"],
    clinicId: input.clinicId,
    doctorId: input.doctorId,
    patientId: input.patientId,
    source: "mutation",
  });
}

/** بعد تغيير موعد */
export function notifyAppointmentMutation(input: {
  clinicId: string;
  doctorId?: string;
}): void {
  notifyClinicSync({
    topic: ["appointments", "queue"],
    clinicId: input.clinicId,
    doctorId: input.doctorId,
    source: "mutation",
  });
}

/**
 * المرحلة 3 — أي حركة مالية (فاتورة، سحب، راتب، صرفية)
 * تُحدّث محفظة الطبيب والسجل المالي واللوحة التنفيذية فوراً.
 */
export function notifyFinancialMutation(input: {
  clinicId: string;
  doctorId?: string;
  patientId?: string;
  alsoSessions?: boolean;
  alsoProfit?: boolean;
}): void {
  const topics: ClinicSyncTopic[] = ["financial"];
  if (input.alsoProfit !== false) topics.push("profit");
  if (input.alsoSessions) topics.push("sessions");

  notifyClinicSync({
    topic: topics,
    clinicId: input.clinicId,
    doctorId: input.doctorId,
    patientId: input.patientId,
    source: "mutation",
  });
}
