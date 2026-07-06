/** استعلام موحّد — يعرض اسم/هاتف المراجع من ملفه الحالي إن وُجد */
export const APPOINTMENT_LIST_SELECT =
  "*, doctor:doctors!doctor_id(full_name_ar), patient:patients!patient_id(full_name_ar, phone, phone_number)";

export const APPOINTMENT_TODAY_SELECT =
  "*, doctor:doctors!doctor_id ( full_name_ar, percentage, materials_share, payment_type ), patient:patients!patient_id(full_name_ar, phone, phone_number)";
