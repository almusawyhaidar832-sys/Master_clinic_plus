import "server-only";

/** Pre-generate MP3 on server so mobile notification sound plays immediately */
export async function warmDoctorCallAudioUrl(
  audioUrl: string | undefined
): Promise<void> {
  if (!audioUrl?.trim()) return;

  try {
    const res = await fetch(audioUrl, {
      cache: "force-cache",
      signal: AbortSignal.timeout(28_000),
    });
    if (!res.ok) {
      console.warn("[queue] warm doctor call audio failed:", res.status);
    }
  } catch (err) {
    console.warn("[queue] warm doctor call audio error:", err);
  }
}
