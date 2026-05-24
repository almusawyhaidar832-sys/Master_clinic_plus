export type UserRole = "super_admin" | "accountant" | "doctor";

export type DoctorPercentage =
  | "10"
  | "20"
  | "30"
  | "40"
  | "50"
  | "60"
  | "70"
  | "80";

export type MaterialsCostShare = "0" | "10" | "20" | "30" | "40" | "50";

export type WithdrawalStatus = "pending" | "approved" | "paid" | "rejected";
export type AppointmentStatus =
  | "scheduled"
  | "confirmed"
  | "completed"
  | "cancelled"
  | "no_show";
export type TreatmentStatus = "active" | "completed" | "cancelled";
export type SalaryEntryType = "advance" | "deduction" | "absence";
export type SalarySlipStatus = "draft" | "paid";

export interface Profile {
  id: string;
  clinic_id: string | null;
  role: UserRole;
  full_name: string;
  username: string | null;
  phone: string | null;
  avatar_url: string | null;
  is_active: boolean;
}

export interface Clinic {
  id: string;
  name: string;
  name_ar: string | null;
  phone: string | null;
  address: string | null;
  logo_url: string | null;
  whatsapp_linked: boolean;
}

export interface Doctor {
  id: string;
  clinic_id: string;
  profile_id: string | null;
  full_name_ar: string;
  specialty_ar: string | null;
  phone: string | null;
  percentage: DoctorPercentage;
  materials_share: MaterialsCostShare;
  is_active: boolean;
}

export interface Patient {
  id: string;
  clinic_id: string;
  full_name_ar: string;
  phone: string | null;
  notes: string | null;
}

export interface PatientOperation {
  id: string;
  clinic_id: string;
  patient_id: string;
  doctor_id: string;
  operation_name_ar: string;
  operation_date: string;
  total_amount: number;
  paid_amount: number;
  remaining_debt: number;
  doctor_share_amount?: number;
  clinic_share_amount?: number;
  patient?: Patient | { full_name_ar: string };
  doctor?: Doctor | { full_name_ar: string };
}

export interface Expense {
  id: string;
  description_ar: string;
  amount: number;
  expense_date: string;
  created_at: string;
}

export interface StaffMember {
  id: string;
  clinic_id: string;
  full_name_ar: string;
  job_title_ar: string;
  base_salary: number;
  phone: string | null;
  slot_number: number | null;
  is_active: boolean;
}

export interface SalaryEntry {
  id: string;
  staff_id: string;
  entry_type: SalaryEntryType;
  amount: number;
  entry_date: string;
  notes_ar: string | null;
}

export interface SalarySlip {
  id: string;
  staff_id: string;
  month_year: string;
  base_salary: number;
  total_advances: number;
  total_deductions: number;
  net_payout: number;
  status: SalarySlipStatus;
  paid_at: string | null;
  staff?: StaffMember;
}

export interface Appointment {
  id: string;
  clinic_id: string;
  doctor_id: string;
  patient_id: string | null;
  patient_name_ar: string | null;
  patient_phone: string | null;
  appointment_date: string;
  start_time: string;
  end_time: string;
  status: AppointmentStatus;
  notes: string | null;
}

export interface ScheduleLock {
  id: string;
  doctor_id: string;
  lock_date: string;
  start_time: string;
  end_time: string;
  reason_ar: string | null;
}

export interface Treatment {
  id: string;
  patient_id: string;
  doctor_id: string;
  title_ar: string;
  description_ar: string | null;
  status: TreatmentStatus;
  started_at: string;
  expected_sessions: number;
  completed_sessions: number;
  patient?: { full_name_ar: string };
}

export interface MedicalLog {
  id: string;
  patient_id: string;
  doctor_id: string;
  log_date: string;
  content_ar: string;
  doctor?: { full_name_ar: string };
}

export interface DoctorWithdrawal {
  id: string;
  doctor_id: string;
  clinic_id: string;
  amount: number;
  status: WithdrawalStatus;
  requested_at: string;
  processed_at?: string | null;
  doctor?: { full_name_ar: string };
}

export interface NavItem {
  href: string;
  label: string;
  icon: string;
  roles?: UserRole[];
}
