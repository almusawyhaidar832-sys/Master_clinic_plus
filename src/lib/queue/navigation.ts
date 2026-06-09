/** صفحة ملف المريض في واجهة الطبيب */
export function buildDoctorPatientUrl(patientId: string) {
  return `/doctor/patients/${patientId}`;
}
