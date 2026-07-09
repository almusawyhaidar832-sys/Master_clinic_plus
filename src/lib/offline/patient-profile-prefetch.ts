import { createClient } from "@/lib/supabase/client";
import { getActiveClinicId, getDoctorForCurrentUser } from "@/lib/clinic-context";
import { fetchPatientClinicalRecords } from "@/lib/clinical/fetch-patient-clinical";
import { cacheXraysForClinicalData } from "@/lib/offline/clinical-xray-cache";
import {
  type PatientProfilePortal,
  writePatientProfileCache,
} from "@/lib/offline/patient-profile-cache";
import { isBrowserOffline } from "@/lib/offline/network";
import { patientBelongsToDoctor } from "@/lib/services/doctor-patients";
import { fetchPatientOperationsForProfile } from "@/lib/services/patient-operations-profile";
import { fetchPatientTreatmentCases } from "@/lib/services/patient-treatment-cases";
import type { MedicalLog, Patient, Treatment } from "@/types";

const inflight = new Set<string>();
const MAX_CONCURRENT = 2;
let activeCount = 0;
const waitQueue: Array<() => void> = [];

function prefetchKey(
  portal: PatientProfilePortal,
  clinicId: string,
  patientId: string
): string {
  return `${portal}:${clinicId}:${patientId}`;
}

async function acquireSlot(): Promise<void> {
  if (activeCount < MAX_CONCURRENT) {
    activeCount += 1;
    return;
  }
  await new Promise<void>((resolve) => {
    waitQueue.push(resolve);
  });
  activeCount += 1;
}

function releaseSlot(): void {
  activeCount = Math.max(0, activeCount - 1);
  const next = waitQueue.shift();
  if (next) next();
}

async function loadDoctorPatientBundle(
  patientId: string,
  doctorId: string,
  clinicId: string
) {
  const supabase = createClient();
  const allowed = await patientBelongsToDoctor(supabase, patientId, doctorId);
  if (!allowed) return;

  const [pRes, lRes, tRes, ops, clinical, cases] = await Promise.all([
    supabase.from("patients").select("*").eq("id", patientId).single(),
    supabase
      .from("medical_logs")
      .select("*, doctor:doctors!doctor_id(full_name_ar)")
      .eq("patient_id", patientId)
      .eq("doctor_id", doctorId)
      .order("log_date", { ascending: false }),
    supabase
      .from("treatments")
      .select("*")
      .eq("patient_id", patientId)
      .eq("doctor_id", doctorId)
      .eq("status", "active"),
    fetchPatientOperationsForProfile(supabase, patientId, { doctorId }),
    fetchPatientClinicalRecords(patientId),
    fetchPatientTreatmentCases(supabase, patientId),
  ]);

  if (!pRes.data) return;

  writePatientProfileCache({
    portal: "doctor",
    clinicId,
    patientId,
    doctorId,
    patient: pRes.data as Patient,
    operations: ops,
    treatmentCases: cases,
    clinicalByOp: clinical,
    medicalLogs: (lRes.data as MedicalLog[]) ?? [],
    treatments: (tRes.data as Treatment[]) ?? [],
  });
  void cacheXraysForClinicalData(patientId, clinical);
}

async function loadAccountantPatientBundle(patientId: string, clinicId: string) {
  const supabase = createClient();
  const [pRes, logsRes, ops, clinical, cases] = await Promise.all([
    supabase
      .from("patients")
      .select("*")
      .eq("id", patientId)
      .eq("clinic_id", clinicId)
      .maybeSingle(),
    supabase
      .from("medical_logs")
      .select("*, doctor:doctors!doctor_id(full_name_ar)")
      .eq("patient_id", patientId)
      .order("log_date", { ascending: false }),
    fetchPatientOperationsForProfile(supabase, patientId, { clinicId }),
    fetchPatientClinicalRecords(patientId, "accountant"),
    fetchPatientTreatmentCases(supabase, patientId, clinicId),
  ]);

  if (!pRes.data) return;

  writePatientProfileCache({
    portal: "accountant",
    clinicId,
    patientId,
    patient: pRes.data as Patient,
    operations: ops,
    treatmentCases: cases,
    clinicalByOp: clinical,
    medicalLogs: (logsRes.data as MedicalLog[]) ?? [],
  });
  void cacheXraysForClinicalData(patientId, clinical);
}

export async function prefetchPatientProfile(input: {
  portal: PatientProfilePortal;
  clinicId: string;
  patientId: string;
  doctorId?: string | null;
}): Promise<void> {
  if (isBrowserOffline() || !input.patientId || !input.clinicId) return;

  const key = prefetchKey(input.portal, input.clinicId, input.patientId);
  if (inflight.has(key)) return;

  inflight.add(key);
  await acquireSlot();
  try {
    if (input.portal === "doctor") {
      if (!input.doctorId) return;
      await loadDoctorPatientBundle(
        input.patientId,
        input.doctorId,
        input.clinicId
      );
      return;
    }
    await loadAccountantPatientBundle(input.patientId, input.clinicId);
  } catch {
    /* prefetch is best-effort */
  } finally {
    inflight.delete(key);
    releaseSlot();
  }
}

export function prefetchPatientProfilesInBackground(
  items: Array<{
    portal: PatientProfilePortal;
    clinicId: string;
    patientId: string;
    doctorId?: string | null;
  }>
): void {
  const unique = new Map<string, (typeof items)[number]>();
  for (const item of items) {
    if (!item.patientId || !item.clinicId) continue;
    unique.set(prefetchKey(item.portal, item.clinicId, item.patientId), item);
  }
  for (const item of unique.values()) {
    void prefetchPatientProfile(item);
  }
}

export async function prefetchTodayQueuePatientProfiles(input: {
  portal: PatientProfilePortal;
  clinicId: string;
  doctorId?: string | null;
  patientIds: Array<string | null | undefined>;
}): Promise<void> {
  const ids = [...new Set(input.patientIds.map((id) => String(id ?? "").trim()).filter(Boolean))];
  prefetchPatientProfilesInBackground(
    ids.map((patientId) => ({
      portal: input.portal,
      clinicId: input.clinicId,
      patientId,
      doctorId: input.doctorId,
    }))
  );
}

export async function prefetchForCurrentDoctorPortal(): Promise<void> {
  if (isBrowserOffline()) return;
  const supabase = createClient();
  const doctor = await getDoctorForCurrentUser(supabase);
  if (!doctor?.clinic_id) return;

  const { data: queueRows } = await supabase
    .from("patient_queue")
    .select("patient_id")
    .eq("doctor_id", doctor.id)
    .eq("queue_date", new Date().toISOString().slice(0, 10))
    .neq("status", "cancelled");

  await prefetchTodayQueuePatientProfiles({
    portal: "doctor",
    clinicId: doctor.clinic_id,
    doctorId: doctor.id,
    patientIds: (queueRows ?? []).map((row) => row.patient_id),
  });
}

export async function prefetchForCurrentAccountantPortal(): Promise<void> {
  if (isBrowserOffline()) return;
  const supabase = createClient();
  const clinic = await getActiveClinicId(supabase);
  if (!clinic?.clinicId) return;

  const { data: queueRows } = await supabase
    .from("patient_queue")
    .select("patient_id")
    .eq("clinic_id", clinic.clinicId)
    .eq("queue_date", new Date().toISOString().slice(0, 10))
    .neq("status", "cancelled");

  await prefetchTodayQueuePatientProfiles({
    portal: "accountant",
    clinicId: clinic.clinicId,
    patientIds: (queueRows ?? []).map((row) => row.patient_id),
  });
}
