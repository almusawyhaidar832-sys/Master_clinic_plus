/** Build public booking URL for a clinic code (client or server). */
export function buildBookingUrl(
  bookingCode: string,
  origin?: string
): string {
  const base =
    origin ??
    (typeof window !== "undefined" ? window.location.origin : "");
  const code = bookingCode.trim();
  return `${base}/booking?clinic=${encodeURIComponent(code)}`;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_RE.test(value.trim());
}
