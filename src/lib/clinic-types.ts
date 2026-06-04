/** أنواع مشتركة — بدون استيراد من clinic-context لتجنب حلقة webpack */
export interface ActiveClinicResult {
  clinicId: string;
  clinicName: string;
  source: "profile" | "fallback" | "developer";
}
