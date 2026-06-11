/**
 * Supabase database types — Master Clinic Plus
 * Tables: clinics, profiles, doctors, patients, appointments,
 *         patient_operations, operation_types, doctor_withdrawals,
 *         expenses, staff_members, notifications, transactions
 */

export type Json = string | number | boolean | null | { [key: string]: Json } | Json[];

export interface Database {
  public: {
    Tables: {
      clinics: {
        Row: {
          id: string;
          name: string;
          name_ar: string | null;
          phone: string | null;
          address: string | null;
          logo_url: string | null;
          whatsapp_linked: boolean;
          whatsapp_session_id: string | null;
          review_fee_enabled: boolean;
          review_fee_amount: number;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<Database["public"]["Tables"]["clinics"]["Row"], "id" | "created_at" | "updated_at"> & {
          id?: string;
        };
        Update: Partial<Database["public"]["Tables"]["clinics"]["Insert"]>;
      };

      profiles: {
        Row: {
          id: string;
          clinic_id: string | null;
          role: "super_admin" | "accountant" | "doctor" | "assistant";
          full_name: string;
          username: string | null;
          phone: string | null;
          avatar_url: string | null;
          base_salary: number;
          job_title: string | null;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<Database["public"]["Tables"]["profiles"]["Row"], "created_at" | "updated_at">;
        Update: Partial<Database["public"]["Tables"]["profiles"]["Insert"]>;
      };

      doctors: {
        Row: {
          id: string;
          clinic_id: string;
          profile_id: string | null;
          full_name_ar: string;
          specialty_ar: string | null;
          phone: string | null;
          percentage: "10" | "20" | "30" | "40" | "50" | "60" | "70" | "80" | "90" | "100";
          materials_share: "0" | "10" | "20" | "30" | "40" | "50" | "60" | "70" | "80" | "90" | "100";
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<Database["public"]["Tables"]["doctors"]["Row"], "id" | "created_at" | "updated_at"> & {
          id?: string;
        };
        Update: Partial<Database["public"]["Tables"]["doctors"]["Insert"]>;
      };

      patients: {
        Row: {
          id: string;
          clinic_id: string;
          full_name_ar: string;
          speech_name_ar: string | null;
          phone: string | null;
          phone_number: string | null;
          notes: string | null;
          doctor_share_total?: number | null;
          previous_total?: number | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<Database["public"]["Tables"]["patients"]["Row"], "id" | "created_at" | "updated_at"> & {
          id?: string;
        };
        Update: Partial<Database["public"]["Tables"]["patients"]["Insert"]>;
      };

      assistants: {
        Row: {
          id: string;
          clinic_id: string;
          doctor_id: string;
          profile_id: string | null;
          full_name_ar: string;
          phone: string | null;
          is_active: boolean;
          total_salary: number;
          doctor_share_percentage: number;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<
          Database["public"]["Tables"]["assistants"]["Row"],
          "id" | "created_at" | "updated_at"
        > & { id?: string };
        Update: Partial<Database["public"]["Tables"]["assistants"]["Insert"]>;
      };

      payroll_records: {
        Row: {
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
          created_at: string;
        };
        Insert: Omit<
          Database["public"]["Tables"]["payroll_records"]["Row"],
          "id" | "generated_at" | "created_at" | "paid_at"
        > & { id?: string; paid_at?: string | null };
        Update: Partial<Database["public"]["Tables"]["payroll_records"]["Insert"]>;
      };

      appointments: {
        Row: {
          id: string;
          clinic_id: string;
          doctor_id: string;
          assistant_id: string | null;
          patient_id: string | null;
          patient_name_ar: string | null;
          patient_phone: string | null;
          appointment_date: string;
          start_time: string;
          end_time: string;
          status:
            | "pending"
            | "scheduled"
            | "confirmed"
            | "waiting"
            | "in_clinic"
            | "in_examination"
            | "completed"
            | "cancelled"
            | "no_show";
          notes: string | null;
          reason_for_change: string | null;
          created_at: string;
        };
        Insert: Omit<Database["public"]["Tables"]["appointments"]["Row"], "id" | "created_at"> & {
          id?: string;
        };
        Update: Partial<Database["public"]["Tables"]["appointments"]["Insert"]>;
      };

      doctor_expenses: {
        Row: {
          id: string;
          clinic_id: string;
          doctor_id: string;
          amount: number;
          percentage_split: number;
          invoice_storage_path: string | null;
          invoice_file_name: string | null;
          invoice_mime_type: string | null;
          expense_date: string;
          description_ar: string | null;
          created_by: string | null;
          created_at: string;
        };
        Insert: Omit<
          Database["public"]["Tables"]["doctor_expenses"]["Row"],
          "id" | "created_at"
        > & { id?: string };
        Update: Partial<Database["public"]["Tables"]["doctor_expenses"]["Insert"]>;
      };

      invoices: {
        Row: {
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
          xray_mime_type: string | null;
          invoice_date: string;
          notes: string | null;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<
          Database["public"]["Tables"]["invoices"]["Row"],
          "id" | "remaining_amount" | "created_at" | "updated_at"
        > & { id?: string };
        Update: Partial<Database["public"]["Tables"]["invoices"]["Insert"]>;
      };

      operation_types: {
        Row: {
          id: string;
          clinic_id: string;
          name_ar: string;
          default_price: number | null;
          is_active: boolean;
          sort_order: number;
          review_fee_amount: number | null;
          created_at: string;
        };
        Insert: Omit<Database["public"]["Tables"]["operation_types"]["Row"], "id" | "created_at"> & {
          id?: string;
        };
        Update: Partial<Database["public"]["Tables"]["operation_types"]["Insert"]>;
      };

      patient_operations: {
        Row: {
          id: string;
          clinic_id: string;
          patient_id: string;
          doctor_id: string;
          operation_type_id: string | null;
          operation_name_ar: string;
          operation_date: string;
          total_amount: number;
          paid_amount: number;
          remaining_debt: number;
          materials_cost: number;
          lab_notes: string | null;
          doctor_share_amount: number;
          clinic_share_amount: number;
          review_fee_amount: number;
          is_review_statement: boolean;
          session_kind?: "plan" | "payment" | "discount" | string | null;
          created_at: string;
        };
        Insert: Omit<Database["public"]["Tables"]["patient_operations"]["Row"],
          "id" | "remaining_debt" | "doctor_share_amount" | "clinic_share_amount" | "created_at"
        > & { id?: string; session_kind?: "plan" | "payment" | "discount" | null };
        Update: Partial<Database["public"]["Tables"]["patient_operations"]["Insert"]>;
      };

      doctor_withdrawals: {
        Row: {
          id: string;
          clinic_id: string;
          doctor_id: string;
          amount: number;
          status: "pending" | "approved" | "paid" | "rejected";
          source: "doctor_request" | "accountant_cash";
          notes: string | null;
          requested_at: string;
          processed_at: string | null;
          processed_by: string | null;
        };
        Insert: Omit<Database["public"]["Tables"]["doctor_withdrawals"]["Row"], "id" | "requested_at"> & {
          id?: string;
        };
        Update: Partial<Database["public"]["Tables"]["doctor_withdrawals"]["Insert"]>;
      };

      expenses: {
        Row: {
          id: string;
          clinic_id: string;
          description_ar: string;
          amount: number;
          expense_date: string;
          created_at: string;
        };
        Insert: Omit<Database["public"]["Tables"]["expenses"]["Row"], "id" | "created_at"> & {
          id?: string;
        };
        Update: Partial<Database["public"]["Tables"]["expenses"]["Insert"]>;
      };

      staff_members: {
        Row: {
          id: string;
          clinic_id: string;
          full_name_ar: string;
          job_title_ar: string;
          base_salary: number;
          phone: string | null;
          slot_number: number | null;
          profile_id: string | null;
          is_active: boolean;
          created_at: string;
        };
        Insert: Omit<Database["public"]["Tables"]["staff_members"]["Row"], "id" | "created_at"> & {
          id?: string;
        };
        Update: Partial<Database["public"]["Tables"]["staff_members"]["Insert"]>;
      };

      notifications: {
        Row: {
          id: string;
          clinic_id: string;
          recipient_profile_id: string;
          title_ar: string;
          body_ar: string;
          link_path: string | null;
          is_read: boolean;
          created_at: string;
        };
        Insert: Omit<Database["public"]["Tables"]["notifications"]["Row"], "id" | "created_at"> & {
          id?: string;
        };
        Update: Partial<Database["public"]["Tables"]["notifications"]["Insert"]>;
      };

      transactions: {
        Row: {
          id: string;
          clinic_id: string;
          doctor_id: string | null;
          patient_id: string | null;
          operation_id: string | null;
          amount: number;
          type: string;
          description_ar: string | null;
          transaction_date: string;
          reference_type: string | null;
          reference_id: string | null;
          created_at: string;
        };
        Insert: Omit<Database["public"]["Tables"]["transactions"]["Row"], "id" | "created_at"> & {
          id?: string;
        };
        Update: Partial<Database["public"]["Tables"]["transactions"]["Insert"]>;
      };

      salary_entries: {
        Row: {
          id: string;
          clinic_id: string;
          staff_id: string;
          entry_type: "advance" | "deduction" | "absence";
          amount: number;
          entry_date: string;
          notes_ar: string | null;
          created_at: string;
        };
        Insert: Omit<Database["public"]["Tables"]["salary_entries"]["Row"], "id" | "created_at"> & {
          id?: string;
        };
        Update: Partial<Database["public"]["Tables"]["salary_entries"]["Insert"]>;
      };

      salary_slips: {
        Row: {
          id: string;
          clinic_id: string;
          staff_id: string;
          month_year: string;
          base_salary: number;
          total_advances: number;
          total_deductions: number;
          net_payout: number;
          status: "draft" | "paid";
          paid_at: string | null;
          created_at: string;
        };
        Insert: Omit<Database["public"]["Tables"]["salary_slips"]["Row"], "id" | "created_at"> & {
          id?: string;
        };
        Update: Partial<Database["public"]["Tables"]["salary_slips"]["Insert"]>;
      };

      patient_queue: {
        Row: {
          id: string;
          clinic_id: string;
          doctor_id: string;
          patient_id: string | null;
          patient_name: string | null;
          patient_phone: string | null;
          ticket_number: number;
          status: "waiting" | "called" | "in_progress" | "done" | "cancelled";
          source: "walk_in" | "appointment" | "online";
          appointment_id: string | null;
          notes: string | null;
          queue_date: string;
          called_at: string | null;
          entered_at: string | null;
          done_at: string | null;
          created_at: string;
        };
        Insert: Omit<
          Database["public"]["Tables"]["patient_queue"]["Row"],
          "id" | "created_at" | "ticket_number"
        > & { id?: string; ticket_number?: number };
        Update: Partial<Database["public"]["Tables"]["patient_queue"]["Insert"]>;
      };

      clinic_settings: {
        Row: {
          id: string;
          clinic_id: string;
          specialty: string;
          enabled_modules: Json;
          module_config: Json;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<Database["public"]["Tables"]["clinic_settings"]["Row"], "id" | "created_at" | "updated_at"> & {
          id?: string;
        };
        Update: Partial<Database["public"]["Tables"]["clinic_settings"]["Insert"]>;
      };

      schedule_locks: {
        Row: {
          id: string;
          clinic_id: string;
          doctor_id: string;
          lock_date: string;
          start_time: string;
          end_time: string;
          reason_ar: string | null;
          created_at: string;
        };
        Insert: Omit<Database["public"]["Tables"]["schedule_locks"]["Row"], "id" | "created_at"> & {
          id?: string;
        };
        Update: Partial<Database["public"]["Tables"]["schedule_locks"]["Insert"]>;
      };

      medical_logs: {
        Row: {
          id: string;
          clinic_id: string;
          patient_id: string;
          doctor_id: string | null;
          title_ar: string;
          body_ar: string | null;
          log_date: string;
          created_at: string;
        };
        Insert: Omit<Database["public"]["Tables"]["medical_logs"]["Row"], "id" | "created_at"> & {
          id?: string;
        };
        Update: Partial<Database["public"]["Tables"]["medical_logs"]["Insert"]>;
      };

      expense_categories: {
        Row: {
          id: string;
          clinic_id: string;
          name_ar: string;
          color: string;
          icon: string;
          is_active: boolean;
          sort_order: number;
          created_at: string;
        };
        Insert: Omit<Database["public"]["Tables"]["expense_categories"]["Row"], "id" | "created_at"> & {
          id?: string;
        };
        Update: Partial<Database["public"]["Tables"]["expense_categories"]["Insert"]>;
      };
    };

    Functions: {
      get_my_clinic_id: { Args: Record<never, never>; Returns: string | null };
      get_my_role: { Args: Record<never, never>; Returns: string | null };
      tenant_can_access: { Args: { p_clinic_id: string }; Returns: boolean };
      get_doctor_wallet_stats: { Args: { p_doctor_id: string }; Returns: Json };
      get_email_for_username: { Args: { p_username: string }; Returns: string | null };
      link_profile_to_first_clinic: { Args: Record<never, never>; Returns: string };
      seed_default_operation_types: { Args: { p_clinic_id: string }; Returns: void };
      seed_clinic_settings: { Args: { p_clinic_id: string; p_specialty?: string }; Returns: void };
      get_clinic_financial_snapshot: {
        Args: { p_clinic_id: string; p_from?: string; p_to?: string };
        Returns: Json;
      };
      get_top_performers: {
        Args: { p_clinic_id: string; p_from?: string; p_to?: string; p_limit?: number };
        Returns: Json;
      };
      get_queue_stats: { Args: { p_clinic_id: string; p_date?: string }; Returns: Json };
    };
    Views: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}
