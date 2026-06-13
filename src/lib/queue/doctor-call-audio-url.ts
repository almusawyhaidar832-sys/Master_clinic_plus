import "server-only";

import crypto from "crypto";
import { resolveBookingPublicOrigin } from "@/lib/booking/public-origin";

function signingSecret(): string {
  const key =
    process.env.VAPID_PRIVATE_KEY?.trim() ||
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!key) throw new Error("missing signing secret for doctor call audio");
  return key;
}

export function signDoctorCallToken(entryId: string, exp: number): string {
  return crypto
    .createHmac("sha256", signingSecret())
    .update(`doctor-call:${entryId}:${exp}`)
    .digest("hex")
    .slice(0, 40);
}

export function verifyDoctorCallToken(
  entryId: string,
  exp: number,
  sig: string
): boolean {
  if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) {
    return false;
  }
  const expected = signDoctorCallToken(entryId, exp);
  if (expected.length !== sig.length) return false;
  try {
    return crypto.timingSafeEqual(
      Buffer.from(expected, "utf8"),
      Buffer.from(sig, "utf8")
    );
  } catch {
    return expected === sig;
  }
}

/** Signed URL — Android notification sound + in-app playback without client TTS delay */
export function buildDoctorCallAudioUrl(entryId: string): string | undefined {
  try {
    const { origin } = resolveBookingPublicOrigin({});
    const exp = Math.floor(Date.now() / 1000) + 7200;
    const sig = signDoctorCallToken(entryId, exp);
    const params = new URLSearchParams({
      entryId,
      exp: String(exp),
      sig,
    });
    return `${origin}/api/tts/doctor-call?${params.toString()}`;
  } catch {
    return undefined;
  }
}
