import type { SupabaseClient } from "@supabase/supabase-js";

export const DOCTOR_EXPENSE_INVOICE_BUCKET = "doctor-expense-invoices";
export const DOCTOR_EXPENSE_INVOICE_URL_TTL_SEC = 3600;

export interface DoctorExpenseInvoiceAttachment {
  storagePath: string;
  fileName: string | null;
  mimeType: string | null;
}

export function doctorExpenseAttachmentFromSnapshot(
  snapshot: Record<string, unknown> | null | undefined
): DoctorExpenseInvoiceAttachment | null {
  const path = String(snapshot?.invoice_storage_path ?? "").trim();
  if (!path) return null;
  return {
    storagePath: path,
    fileName: String(snapshot?.invoice_file_name ?? "").trim() || null,
    mimeType: String(snapshot?.invoice_mime_type ?? "").trim() || null,
  };
}

export function doctorExpenseHasAttachmentHint(input: {
  recordKind?: string | null;
  doctorExpenseId?: string | null;
  snapshot?: Record<string, unknown> | null;
}): boolean {
  if (input.recordKind !== "doctor_expense" && !input.doctorExpenseId) {
    return false;
  }
  if (doctorExpenseAttachmentFromSnapshot(input.snapshot ?? null)) return true;
  const fileName = String(input.snapshot?.invoice_file_name ?? "").trim();
  return !!fileName;
}

export async function fetchDoctorExpenseAttachment(
  admin: SupabaseClient,
  expenseId: string
): Promise<DoctorExpenseInvoiceAttachment | null> {
  const { data } = await admin
    .from("doctor_expenses")
    .select("invoice_storage_path, invoice_file_name, invoice_mime_type")
    .eq("id", expenseId)
    .maybeSingle();

  const path = String(data?.invoice_storage_path ?? "").trim();
  if (!path) return null;

  return {
    storagePath: path,
    fileName: (data?.invoice_file_name as string | null) ?? null,
    mimeType: (data?.invoice_mime_type as string | null) ?? null,
  };
}

export async function createDoctorExpenseInvoiceSignedUrl(
  admin: SupabaseClient,
  storagePath: string
): Promise<string | null> {
  const { data, error } = await admin.storage
    .from(DOCTOR_EXPENSE_INVOICE_BUCKET)
    .createSignedUrl(storagePath, DOCTOR_EXPENSE_INVOICE_URL_TTL_SEC);

  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}
