const STORAGE_KEY = "mcp_queue_screen_clinic_ref";

/** رمز العيادة المحفوظ على تلفاز صالة الانتظار */
export function loadSavedQueueScreenClinicRef(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY)?.trim();
    return raw || null;
  } catch {
    return null;
  }
}

export function saveQueueScreenClinicRef(ref: string): void {
  if (typeof window === "undefined") return;
  const trimmed = ref.trim();
  if (!trimmed) return;
  try {
    localStorage.setItem(STORAGE_KEY, trimmed);
  } catch {
    // ignore quota / private mode
  }
}

export function clearQueueScreenClinicRef(): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
