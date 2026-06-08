/** Hostnames that phones/other devices cannot reach when encoded in a QR code. */
export function isLocalHostname(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return (
    h === "localhost" ||
    h === "127.0.0.1" ||
    h === "[::1]" ||
    h === "0.0.0.0"
  );
}

export function isLocalOrigin(url: string): boolean {
  try {
    const normalized = url.includes("://") ? url : `http://${url}`;
    const u = new URL(normalized);
    return isLocalHostname(u.hostname);
  } catch {
    return false;
  }
}

function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

export interface ResolvePublicOriginInput {
  envUrl?: string | null;
  requestOrigin?: string | null;
  clientOrigin?: string | null;
  forwardedHost?: string | null;
  forwardedProto?: string | null;
}

export interface ResolvedPublicOrigin {
  origin: string;
  /** true when QR scans will fail on other devices (localhost, etc.) */
  unreachableOnMobile: boolean;
}

/**
 * Pick the URL embedded in booking QR codes.
 * Prefers NEXT_PUBLIC_APP_URL so mobiles can reach the site (LAN IP or production domain).
 */
export function resolveBookingPublicOrigin(
  input: ResolvePublicOriginInput = {}
): ResolvedPublicOrigin {
  const env =
    input.envUrl?.trim() ||
    (typeof process !== "undefined"
      ? process.env.NEXT_PUBLIC_APP_URL?.trim()
      : undefined);

  if (env) {
    const origin = stripTrailingSlash(env);
    return {
      origin,
      unreachableOnMobile: isLocalOrigin(origin),
    };
  }

  if (input.forwardedHost) {
    const proto = input.forwardedProto?.split(",")[0]?.trim() || "https";
    const origin = stripTrailingSlash(`${proto}://${input.forwardedHost}`);
    if (!isLocalOrigin(origin)) {
      return { origin, unreachableOnMobile: false };
    }
  }

  for (const candidate of [input.requestOrigin, input.clientOrigin]) {
    const trimmed = candidate?.trim();
    if (trimmed && !isLocalOrigin(trimmed)) {
      return {
        origin: stripTrailingSlash(trimmed),
        unreachableOnMobile: false,
      };
    }
  }

  const fallback = stripTrailingSlash(
    input.requestOrigin?.trim() ||
      input.clientOrigin?.trim() ||
      "http://localhost:3000"
  );

  return { origin: fallback, unreachableOnMobile: true };
}
