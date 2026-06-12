"use client";

import { useMemo } from "react";
import { useLanguage } from "@/contexts/LanguageContext";
import type { Language, TranslationKey } from "@/i18n/translations";
import type { ClinicSpecialty } from "@/types/modules";

const APPOINTMENT_STATUS_KEYS: Record<string, TranslationKey> = {
  pending: "apptStatus_pending",
  scheduled: "apptStatus_scheduled",
  confirmed: "apptStatus_confirmed",
  waiting: "apptStatus_waiting",
  in_clinic: "apptStatus_in_clinic",
  in_examination: "apptStatus_in_examination",
  ready_for_billing: "apptStatus_ready_for_billing",
  ready_for_payment: "apptStatus_ready_for_payment",
  completed: "apptStatus_completed",
  cancelled: "apptStatus_cancelled",
  no_show: "apptStatus_no_show",
};

const SPECIALTY_KEYS: Record<ClinicSpecialty, TranslationKey> = {
  dental: "specialty_dental",
  general_medicine: "specialty_general_medicine",
  cosmetic: "specialty_cosmetic",
  pediatrics: "specialty_pediatrics",
  ophthalmology: "specialty_ophthalmology",
  physiotherapy: "specialty_physiotherapy",
  custom: "specialty_custom",
};

const USER_ROLE_KEYS: Record<string, TranslationKey> = {
  super_admin: "roleSuperAdminFull",
  accountant: "roleAccountantReception",
  doctor: "roleDoctor",
  assistant: "roleAssistantDoctor",
};

export function getAppointmentStatusLabels(
  t: (key: TranslationKey) => string
): Record<string, string> {
  const labels: Record<string, string> = {};
  for (const [status, key] of Object.entries(APPOINTMENT_STATUS_KEYS)) {
    labels[status] = t(key);
  }
  return labels;
}

export function getSpecialtyLabel(
  t: (key: TranslationKey) => string,
  specialty: ClinicSpecialty
): string {
  return t(SPECIALTY_KEYS[specialty]);
}

export function getUserRoleLabels(
  t: (key: TranslationKey) => string
): Record<string, string> {
  const labels: Record<string, string> = {};
  for (const [role, key] of Object.entries(USER_ROLE_KEYS)) {
    labels[role] = t(key);
  }
  return labels;
}

export type QueueStatusKey =
  | "waiting"
  | "called"
  | "in_progress"
  | "ready_for_billing"
  | "ready_for_payment"
  | "done"
  | "cancelled";

const QUEUE_STATUS_KEYS: Record<QueueStatusKey, TranslationKey> = {
  waiting: "waitingStatus",
  called: "calledStatus",
  in_progress: "inProgressStatus",
  ready_for_billing: "apptStatus_ready_for_billing",
  ready_for_payment: "apptStatus_ready_for_payment",
  done: "doneStatus",
  cancelled: "cancelledStatus",
};

export function getQueueStatusLabel(
  t: (key: TranslationKey) => string,
  status: QueueStatusKey
): string {
  return t(QUEUE_STATUS_KEYS[status]);
}

export function useAppointmentStatusLabels(): Record<string, string> {
  const { t } = useLanguage();
  return useMemo(() => getAppointmentStatusLabels(t), [t]);
}

export function useUserRoleLabels(): Record<string, string> {
  const { t } = useLanguage();
  return useMemo(() => getUserRoleLabels(t), [t]);
}

export function useSpecialtyLabel(specialty: ClinicSpecialty): string {
  const { t } = useLanguage();
  return useMemo(() => getSpecialtyLabel(t, specialty), [t, specialty]);
}
