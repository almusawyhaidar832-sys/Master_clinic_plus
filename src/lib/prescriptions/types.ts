export type PrescriptionStatus = "draft" | "finalized" | "printed";

export interface PrescriptionMedication {
  drug_name_ar: string;
  dosage?: string;
  frequency?: string;
  duration?: string;
  instructions?: string;
}

export interface PatientPrescription {
  id: string;
  clinic_id: string;
  patient_id: string;
  doctor_id: string;
  operation_id: string | null;
  queue_entry_id: string | null;
  prescription_date: string;
  diagnosis_ar: string | null;
  notes_ar: string | null;
  medications: PrescriptionMedication[];
  status: PrescriptionStatus;
  created_by: string | null;
  printed_at: string | null;
  printed_by: string | null;
  created_at: string;
  updated_at: string;
}

import type { ClinicProfile } from "@/types/clinic-profile";

export interface PrescriptionPrintData {
  prescription: PatientPrescription;
  patientName: string;
  patientPhone: string | null;
  doctorName: string;
  clinic: ClinicProfile | null;
}

export interface PrescriptionTemplate {
  id: string;
  name_ar: string;
  diagnosis_ar?: string;
  medications: PrescriptionMedication[];
}
