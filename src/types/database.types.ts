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
          role: "super_admin" | "accountant" | "doctor";
          full_name: string;
          username: string | null;
          phone: string | null;
          avatar_url: string | null;
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
          percentage: "10" | "20" | "30" | "40" | "50" | "60" | "70" | "80";
          materials_share: "0" | "10" | "20" | "30" | "40" | "50";
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
          phone: string | null;
          notes: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<Database["public"]["Tables"]["patients"]["Row"], "id" | "created_at" | "updated_at"> & {
          id?: string;
        };
        Update: Partial<Database["public"]["Tables"]["patients"]["Insert"]>;
      };

      appointments: {
        Row: {
          id: string;
          clinic_id: string;
          doctor_id: string;
          patient_id: string | null;
          patient_name_ar: string | null;
          patient_phone: string | null;
          appointment_date: string;
          start_time: string;
          end_time: string;
          status: "scheduled" | "confirmed" | "completed" | "cancelled" | "no_show";
          notes: string | null;
          created_at: string;
        };
        Insert: Omit<Database["public"]["Tables"]["appointments"]["Row"], "id" | "created_at"> & {
          id?: string;
        };
        Update: Partial<Database["public"]["Tables"]["appointments"]["Insert"]>;
      };

      operation_types: {
        Row: {
          id: string;
          clinic_id: string;
          name_ar: string;
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
          doctor_share_amount: number;
          clinic_share_amount: number;
          review_fee_amount: number;
          is_review_statement: boolean;
          created_at: string;
        };
        Insert: Omit<Database["public"]["Tables"]["patient_operations"]["Row"],
          "id" | "remaining_debt" | "doctor_share_amount" | "clinic_share_amount" | "created_at"
        > & { id?: string };
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
          created_at: string;
        };
        Insert: Omit<Database["public"]["Tables"]["transactions"]["Row"], "id" | "created_at"> & {
          id?: string;
        };
        Update: Partial<Database["public"]["Tables"]["transactions"]["Insert"]>;
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
    };
  };
}
