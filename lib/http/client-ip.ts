// lib/http/client-ip.ts
//
// Resolves the caller's IP from request headers, for rate-limit keys.
//
// Trust model: on Vercel the platform sets x-vercel-forwarded-for /
// x-real-ip / x-forwarded-for itself and overwrites anything the client
// sent, so the first hop is the real client. If this app is ever
// self-hosted with `next start` and NO reverse proxy in front, those
// headers are client-controlled and an IP limiter can be dodged by
// spoofing them — put a proxy in front (or set the header from it) before
// relying on IP limits off-Vercel.
//
// Pure module (only node:net for validation) so scripts/verify-security-
// guards.ts can exercise it without booting Next.

import { isIP } from 'node:net';

export interface HeaderReader {
  get(name: string): string | null;
}

/** Strips a port ("1.2.3.4:5678", "[::1]:443") and validates the address. */
function sanitizeIp(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let value = raw.trim();
  if (!value) return null;

  const bracketed = value.match(/^\[([^\]]+)\](?::\d+)?$/);
  if (bracketed) value = bracketed[1];
  else if (/^\d{1,3}(?:\.\d{1,3}){3}:\d+$/.test(value)) value = value.slice(0, value.lastIndexOf(':'));

  return isIP(value) ? value : null;
}

/** Leftmost x-forwarded-for entry — the original client. */
function firstHop(header: string | null): string | null {
  if (!header) return null;
  return header.split(',')[0]?.trim() || null;
}

export function clientIpFromHeaders(h: HeaderReader | null | undefined): string | null {
  if (!h) return null;
  const candidates = [h.get('x-vercel-forwarded-for'), h.get('x-real-ip'), firstHop(h.get('x-forwarded-for'))];
  for (const candidate of candidates) {
    const ip = sanitizeIp(candidate);
    if (ip) return ip;
  }
  return null;
}

/** Expands "::"-compressed IPv6 into exactly 8 hextets, or null if malformed. */
function expandIpv6(ip: string): string[] | null {
  const zoneless = ip.split('%')[0];
  const halves = zoneless.split('::');
  if (halves.length > 2) return null;

  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];

  // An embedded IPv4 tail ("::ffff:1.2.3.4") occupies two hextets.
  const lastOf = (parts: string[]): string[] => {
    const last = parts[parts.length - 1];
    if (last && last.includes('.')) {
      const octets = last.split('.').map(Number);
      if (octets.length !== 4 || octets.some((o) => !Number.isInteger(o) || o < 0 || o > 255)) return parts;
      const hi = ((octets[0] << 8) | octets[1]).toString(16);
      const lo = ((octets[2] << 8) | octets[3]).toString(16);
      return [...parts.slice(0, -1), hi, lo];
    }
    return parts;
  };

  const h = halves.length === 2 ? head : lastOf(head);
  const t = halves.length === 2 ? lastOf(tail) : [];

  if (halves.length === 1) return h.length === 8 ? h.map((x) => x.padStart(4, '0')) : null;

  const missing = 8 - (h.length + t.length);
  if (missing < 1) return null;
  return [...h, ...Array<string>(missing).fill('0'), ...t].map((x) => x.padStart(4, '0'));
}

/**
 * The string actually used as a limiter key.
 *
 *  - IPv4: as-is.
 *  - IPv4-mapped IPv6 (::ffff:1.2.3.4): collapsed to the IPv4.
 *  - Any other IPv6: truncated to its /64. A single subscriber is normally
 *    handed at least a /64, so keying on the full address would let one
 *    attacker rotate through 2^64 "different" IPs and never hit the limit.
 */
export function ipRateLimitKey(ip: string): string {
  if (isIP(ip) !== 6) return ip;

  const hextets = expandIpv6(ip);
  if (!hextets) return ip;

  const isMapped =
    hextets.slice(0, 5).every((x) => x === '0000') && hextets[5] === 'ffff';
  if (isMapped) {
    const hi = parseInt(hextets[6], 16);
    const lo = parseInt(hextets[7], 16);
    return `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
  }
  return `${hextets.slice(0, 4).join(':')}::/64`;
}

/** Headers -> limiter key, or null when no trustworthy IP is available. */
export function clientIpKey(h: HeaderReader | null | undefined): string | null {
  const ip = clientIpFromHeaders(h);
  return ip ? ipRateLimitKey(ip) : null;
}
