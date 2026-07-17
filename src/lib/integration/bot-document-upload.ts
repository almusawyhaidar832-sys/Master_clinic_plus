import "server-only";

import crypto from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

export const BOT_OUTBOUND_DOCUMENTS_BUCKET = "bot-outbound-documents";
/** كافية لاستلام الرسالة عبر واتساب دون الحاجة لتخزين طويل الأمد */
const SIGNED_URL_TTL_SEC = 24 * 60 * 60;

function safeStorageFileName(name: string): string {
  const base = String(name ?? "")
    .trim()
    .replace(/[^\w.\-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base.toLowerCase().endsWith(".pdf") ? base : `${base || "document"}.pdf`;
}

/**
 * يرفع PDF (فاتورة/وصفة) إلى مخزن مؤقت ويرجع رابط موقّع لإرساله عبر webhook N8N
 * بدل تضمين الملف كـ Base64 داخل الحمولة. عند الفشل يرجع null ولا يرمي أبداً.
 */
export async function uploadBotOutboundDocument(
  admin: SupabaseClient,
  params: { clinicId: string; pdfBase64: string; fileName: string }
): Promise<{ signedUrl: string; storagePath: string } | null> {
  try {
    const buffer = Buffer.from(params.pdfBase64, "base64");
    if (!buffer.length) return null;

    const storagePath = `${params.clinicId}/${crypto.randomUUID()}-${safeStorageFileName(
      params.fileName
    )}`;

    const { error: uploadError } = await admin.storage
      .from(BOT_OUTBOUND_DOCUMENTS_BUCKET)
      .upload(storagePath, buffer, {
        contentType: "application/pdf",
        upsert: false,
      });

    if (uploadError) {
      console.error("[bot-document-upload] upload_failed", uploadError.message);
      return null;
    }

    const { data, error: signError } = await admin.storage
      .from(BOT_OUTBOUND_DOCUMENTS_BUCKET)
      .createSignedUrl(storagePath, SIGNED_URL_TTL_SEC);

    if (signError || !data?.signedUrl) {
      console.error("[bot-document-upload] sign_failed", signError?.message);
      return null;
    }

    return { signedUrl: data.signedUrl, storagePath };
  } catch (e) {
    console.error(
      "[bot-document-upload] unexpected_error",
      e instanceof Error ? e.message : e
    );
    return null;
  }
}
