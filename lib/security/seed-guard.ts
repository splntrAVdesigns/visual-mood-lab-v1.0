// lib/security/seed-guard.ts
//
// Authorization decision for POST /api/seed, as a pure function so it can be
// tested without booting Next or touching a database.
//
// Why this exists: the route used to be an unauthenticated GET. With
// ALLOW_SEED_ROUTE set in production, `GET /api/seed?fresh=1` dropped the
// boards / board_items / assets / _migrations tables for anyone who could
// reach the URL — and a GET can be triggered by a link prefetch, a crawler,
// or an <img> tag on another site.
//
// Rules:
//   production:  ALLOW_SEED_ROUTE must be on  AND  SEED_ADMIN_SECRET must be
//                configured (>= 24 chars)     AND  the request must carry
//                `Authorization: Bearer <secret>`. `fresh` is refused outright.
//   otherwise:   open for local convenience — unless SEED_ADMIN_SECRET is set,
//                in which case it is enforced the same way.
//   always:      a request carrying an Origin header must be same-origin
//                (blocks a random web page POSTing at a developer's localhost).

import { createHash, timingSafeEqual } from 'node:crypto';

export const MIN_SEED_SECRET_LENGTH = 24;

export interface SeedRequestFacts {
  nodeEnv: string | undefined;
  allowSeedRoute: string | undefined;
  adminSecret: string | undefined;
  authorization: string | null;
  origin: string | null;
  host: string | null;
  fresh: boolean;
}

export type SeedDecision =
  | { ok: true }
  | { ok: false; status: 401 | 403; error: string };

/** "1"/"true"/anything non-empty is on; "", "0", "false", "no", "off" are off. */
export function isFlagOn(value: string | undefined): boolean {
  if (value === undefined) return false;
  const v = value.trim().toLowerCase();
  return v !== '' && v !== '0' && v !== 'false' && v !== 'no' && v !== 'off';
}

function digest(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

/** Constant-time comparison; hashing first equalizes lengths. */
export function secretsMatch(provided: string, expected: string): boolean {
  return timingSafeEqual(digest(provided), digest(expected));
}

function bearerToken(authorization: string | null): string | null {
  if (!authorization) return null;
  const m = authorization.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}

export function evaluateSeedRequest(facts: SeedRequestFacts): SeedDecision {
  const isProd = facts.nodeEnv === 'production';

  if (facts.origin) {
    let originHost: string | null = null;
    try {
      originHost = new URL(facts.origin).host;
    } catch {
      originHost = null;
    }
    if (!originHost || originHost !== facts.host) {
      return { ok: false, status: 403, error: 'Cross-origin seed requests are not allowed' };
    }
  }

  if (isProd) {
    if (!isFlagOn(facts.allowSeedRoute)) {
      return { ok: false, status: 403, error: 'Seed route disabled in production' };
    }
    if (!facts.adminSecret || facts.adminSecret.length < MIN_SEED_SECRET_LENGTH) {
      return {
        ok: false,
        status: 403,
        error: `Seed route is not configured: set SEED_ADMIN_SECRET (at least ${MIN_SEED_SECRET_LENGTH} characters)`,
      };
    }
  }

  const secretRequired = isProd || Boolean(facts.adminSecret);
  if (secretRequired) {
    const provided = bearerToken(facts.authorization);
    if (!provided || !facts.adminSecret || !secretsMatch(provided, facts.adminSecret)) {
      return { ok: false, status: 401, error: 'Unauthorized' };
    }
  }

  // Checked AFTER auth so an unauthenticated caller learns nothing about it.
  if (isProd && facts.fresh) {
    return {
      ok: false,
      status: 403,
      error:
        'The fresh option is disabled in production. To rebuild a database, run `npm run seed:fresh` from a trusted machine.',
    };
  }

  return { ok: true };
}
