export interface PublicClinicSummary {
  id: string;
  name: string;
  nameAr: string | null;
  address: string | null;
  phone: string | null;
  logoUrl: string | null;
  bookingCode: string;
}

export interface PublicDoctorOption {
  id: string;
  fullNameAr: string;
  specialtyAr: string | null;
}

export interface ResolvedBookingClinic {
  id: string;
  name: string;
  nameAr: string | null;
  address: string | null;
  phone: string | null;
  logoUrl: string | null;
  bookingCode: string;
  doctors: PublicDoctorOption[];
}
