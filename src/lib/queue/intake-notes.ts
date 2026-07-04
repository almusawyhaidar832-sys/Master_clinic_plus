/** نص إشعار الطبيب مع ملاحظة المحاسب (إن وُجدت) */
export function formatDoctorQueueAlertMessage(
  name: string,
  options?: { recall?: boolean; notes?: string | null }
): string {
  const base = options?.recall
    ? `تذكير: المراجع ${name} بانتظارك — يرجى استقباله`
    : `لديك مراجع جديد في الانتظار: ${name}`;
  const notes = options?.notes?.trim();
  if (!notes) return base;
  return `${base}\nملاحظة المحاسب: ${notes}`;
}

export function trimQueueIntakeNotes(notes?: string | null): string | null {
  const trimmed = notes?.trim();
  return trimmed || null;
}

export function trimDoctorQueueNotes(notes?: string | null): string | null {
  const trimmed = notes?.trim();
  return trimmed || null;
}

/** نص إشعار المحاسب مع ملاحظة الطبيب (إن وُجدت) */
export function formatAccountantBillingAlertMessage(
  name: string,
  doctorNotes?: string | null
): string {
  const base = `المراجع ${name} — أكمل الجلسة وتوجّه إليك للدفع`;
  const notes = trimDoctorQueueNotes(doctorNotes);
  if (!notes) return base;
  return `${base}\nملاحظة الطبيب: ${notes}`;
}
