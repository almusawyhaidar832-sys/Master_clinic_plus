/** Tenant white-label profile — single source for clinic branding */

import type { ClinicSpecialty } from "@/types/modules";

export interface ClinicProfile {
  id: string;
  name: string;
  name_ar: string | null;
  phone: string | null;
  address: string | null;
  logo_url: string | null;
  whatsapp_linked: boolean;
  review_fee_enabled?: boolean;
  review_fee_amount?: number;
  /** Joined from clinic_settings — available after full profile fetch */
  specialty?: ClinicSpecialty;
}

export type ClinicProfileUpdate = Partial<
  Pick<
    ClinicProfile,
    | "name"
    | "name_ar"
    | "phone"
    | "address"
    | "logo_url"
    | "review_fee_enabled"
    | "review_fee_amount"
  >
>;
