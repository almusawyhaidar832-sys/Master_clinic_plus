/**
 * جسر WhatsApp — Evolution API v2
 * @see docs/WHATSAPP_EVOLUTION_SETUP.md
 */

export { getWhatsAppConfig, type WhatsAppProvider } from "./config";
export {
  evolutionFetch,
  extractQrImageSrc,
  parseConnectionState,
  ensureEvolutionInstance,
  fetchEvolutionQr,
  fetchEvolutionConnectionState,
  resolveEvolutionSession,
  ensureEvolutionInstanceNamed,
  restartEvolutionInstance,
  sendEvolutionText,
  type EvolutionConnectionState,
  type EvolutionQrResult,
} from "./evolution-client";
export { deliverWhatsAppMessage, type WhatsAppSendOutcome } from "./send-message";
