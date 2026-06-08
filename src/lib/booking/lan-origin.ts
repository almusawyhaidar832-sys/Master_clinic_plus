import "server-only";

import os from "os";

/** أول IPv4 على الشبكة المحلية — للباركود على الموبايل أثناء التطوير */
export function detectDevLanOrigin(port = 3000): string | null {
  if (process.env.NODE_ENV === "production") return null;

  const ifaces = os.networkInterfaces();
  const candidates: string[] = [];

  for (const configs of Object.values(ifaces)) {
    for (const cfg of configs ?? []) {
      if (cfg.family !== "IPv4" || cfg.internal) continue;
      candidates.push(cfg.address);
    }
  }

  const preferred = candidates.find((ip) => ip.startsWith("192.168."));
  const chosen = preferred ?? candidates[0];
  if (!chosen) return null;

  return `http://${chosen}:${port}`;
}

export function portFromOrigin(origin: string): number {
  try {
    const p = new URL(origin).port;
    if (p) return Number.parseInt(p, 10) || 3000;
    return new URL(origin).protocol === "https:" ? 443 : 3000;
  } catch {
    return 3000;
  }
}
