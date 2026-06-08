export type UserRole = "super_admin" | "accountant" | "doctor" | "assistant";

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

export type DoctorPaymentType = "percentage" | "salary";

export type WithdrawalStatus = "pending" | "approved" | "paid" | "rejected";
export type WithdrawalSource = "doctor_request" | "accountant_cash";
export type AppointmentStatus =
  | "pending"
  | "scheduled"
  | "confirmed"
  | "waiting"
  | "in_clinic"
  | "in_examination"
  | "completed"
  | "cancelled"
  | "no_show";

export interface OperationType {
  id: string;
  clinic_id: string;
  name_ar: string;
  default_price: number | null;
  is_active: boolean;
  sort_order: number;
}

export interface Invoice {
  id: string;
  clinic_id: string;
  patient_id: string | null;
  doctor_id: string | null;
  operation_id: string | null;
  appointment_id: string | null;
  total_amount: number;
  paid_amount: number;
  remaining_amount: number;
  xray_storage_path: string | null;
  xray_file_name: string | null;
  invoice_date: string;
  notes: string | null;
}
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
  review_fee_enabled?: boolean;
  review_fee_amount?: number;
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
  payment_type?: DoctorPaymentType;
  salary_amount?: number;
  is_active: boolean;
}

export interface Patient {
  id: string;
  clinic_id: string;
  full_name_ar: string;
  phone: string | null;
  /** رقم هاتف المراجع — مرجع الواتساب (+964...) */
  phone_number?: string | null;
  notes: string | null;
  /** Last session total — used for follow-up visits */
  previous_total?: number | null;
  agreed_total?: number | null;
  doctor_share_total?: number | null;
  clinic_share_total?: number | null;
  total_paid?: number | null;
  financial_locked?: boolean | null;
  original_agreed_total?: number | null;
  discount_total?: number | null;
  treatment_status?: "active" | "completed" | null;
  /** الطبيب المعالج للجلسات الجديدة */
  primary_doctor_id?: string | null;
}

export interface OperationToothRecord {
  id: string;
  operation_id: string;
  clinic_id: string;
  tooth_number: number;
  procedure_ar: string;
  note: string | null;
  created_at?: string;
}

export interface OperationXrayImage {
  id: string;
  operation_id: string;
  clinic_id: string;
  storage_path: string;
  file_name: string | null;
  mime_type: string | null;
  created_at?: string;
}

export interface PatientOperation {
  id: string;
  clinic_id: string;
  patient_id: string;
  doctor_id: string;
  /** New schema column name (user's DB) */
  operation_type?: string;
  /** Legacy column name (our migration) — one of the two will be present */
  operation_name_ar?: string;
  operation_date?: string;
  total_amount: number;
  paid_amount: number;
  /** May be a generated/computed column — use opDebt() helper instead of accessing directly */
  remaining_debt?: number;
  materials_cost?: number;
  doctor_share_amount?: number;
  clinic_share_amount?: number;
  notes?: string | null;
  is_review_statement?: boolean;
  session_kind?: "plan" | "payment" | "discount" | "refund";
  treatment_case_id?: string | null;
  created_at?: string;
  patient?: Patient | { full_name_ar: string };
  doctor?: Doctor | { full_name_ar: string };
}

/** Get operation display name — works with both operation_type and operation_name_ar columns */
export function opName(op: PatientOperation): string {
  return op.operation_type || op.operation_name_ar || "عملية";
}

/** اسم الحالة من الجلسة — يفضّل الاسم العربي لتوحيد الجلسات القديمة والجديدة */
export function operationLabelForCase(op: PatientOperation): string {
  const raw = (op.operation_name_ar || op.operation_type || "").trim();
  const base = raw.replace(/\s*—\s*خصم.*$/i, "").trim();
  return base || raw || "علاج";
}

/** Get remaining debt — works whether remaining_debt is a DB column or needs computing */
export function opDebt(op: PatientOperation): number {
  if (op.remaining_debt !== undefined) return Math.max(0, op.remaining_debt);
  return Math.max(0, op.total_amount - op.paid_amount);
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
  profile_id?: string | null;
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

export interface Assistant {
  id: string;
  clinic_id: string;
  doctor_id: string;
  profile_id: string | null;
  full_name_ar: string;
  phone: string | null;
  is_active: boolean;
  total_salary: number;
  doctor_share_percentage: number;
  created_at?: string;
  updated_at?: string;
}

export interface PayrollRecord {
  id: string;
  clinic_id: string;
  assistant_id: string;
  doctor_id: string;
  month_year: string;
  assistant_name_ar: string;
  doctor_name_ar: string | null;
  total_salary: number;
  doctor_share_percentage: number;
  doctor_share_amount: number;
  clinic_share_amount: number;
  status: "generated" | "paid";
  generated_at: string;
  paid_at: string | null;
  created_at?: string;
}

export interface DoctorExpense {
  id: string;
  clinic_id: string;
  doctor_id: string;
  amount: number;
  percentage_split: number;
  invoice_storage_path: string | null;
  invoice_file_name: string | null;
  expense_date: string;
  description_ar: string | null;
}

export interface Appointment {
  id: string;
  clinic_id: string;
  doctor_id: string;
  assistant_id?: string | null;
  patient_id: string | null;
  patient_name_ar: string | null;
  patient_phone: string | null;
  appointment_date: string;
  start_time: string;
  end_time: string;
  status: AppointmentStatus;
  notes: string | null;
  reason_for_change?: string | null;
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
  source?: WithdrawalSource;
  requested_at: string;
  processed_at?: string | null;
  notes?: string | null;
  doctor?: { full_name_ar: string };
}

export interface NavItem {
  href: string;
  label: string;
  icon: string;
  roles?: UserRole[];
}
