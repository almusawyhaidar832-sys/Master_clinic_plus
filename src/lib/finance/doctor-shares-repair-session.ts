/** إصدار إصلاح الحصص — ارفعه عند تغيير منطق الحساب ليعيد الإصلاح تلقائياً */
export const DOCTOR_SHARES_REPAIR_VERSION = "v10";

function prefix() {
  return `mc:doctor-shares-auto-repair:${DOCTOR_SHARES_REPAIR_VERSION}`;
}

export function clinicSharesRepairKey(clinicId: string): string {
  return `${prefix()}:${clinicId}`;
}

export function doctorSharesRepairKey(doctorId: string): string {
  return `${prefix()}:${doctorId}`;
}

export function doctorClinicSharesRepairKey(
  clinicId: string,
  doctorId: string
): string {
  return `${prefix()}:${clinicId}:${doctorId}`;
}

export function needsSharesRepair(key: string): boolean {
  if (typeof window === "undefined") return false;
  return !sessionStorage.getItem(key);
}

/** بعد إصلاح ناجح — يمنع تكرار الإصلاح ويوحّد حالة الطبيب والإدارة */
export function markSharesRepairDone(opts: {
  clinicId?: string | null;
  doctorId?: string | null;
}): void {
  if (typeof window === "undefined") return;
  if (opts.doctorId) {
    sessionStorage.setItem(doctorSharesRepairKey(opts.doctorId), "1");
  }
  if (opts.clinicId) {
    sessionStorage.setItem(clinicSharesRepairKey(opts.clinicId), "1");
  }
  if (opts.clinicId && opts.doctorId) {
    sessionStorage.setItem(
      doctorClinicSharesRepairKey(opts.clinicId, opts.doctorId),
      "1"
    );
  }
}
