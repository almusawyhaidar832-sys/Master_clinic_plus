/** إعدادات جسر WhatsApp (Evolution API v2 — Baileys) */

export type WhatsAppProvider = "evolution" | "legacy";

export function getWhatsAppConfig() {
  const baseUrl = process.env.WHATSAPP_API_URL?.replace(/\/$/, "") ?? "";
  const apiKey =
    process.env.WHATSAPP_API_KEY?.trim() ||
    process.env.WHATSAPP_API_SECRET?.trim() ||
    "";
  const instanceName =
    process.env.WHATSAPP_INSTANCE_NAME?.trim() || "master_clinic";
  const provider: WhatsAppProvider =
    process.env.WHATSAPP_PROVIDER === "legacy" ? "legacy" : "evolution";

  return {
    baseUrl,
    apiKey,
    instanceName,
    provider,
    configured: Boolean(baseUrl && apiKey),
  };
}
