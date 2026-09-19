// lib/auth/rate-limit.ts
//
// Free tier on Upstash covers this comfortably at hobby-project volume.
//
// Every limiter here is a thin wrapper with ONE method, `limit(key)`, so call
// sites don't change shape. Two behaviours the wrapper adds over a bare
// Upstash Ratelimit:
//
//   * FAIL-OPEN. If Upstash env vars are missing (local dev) or Upstash is
//     unreachable, `limit()` reports success and logs, instead of throwing.
//     Previously a Redis outage threw out of authorize() and broke every
//     login. In production a missing config is logged loudly, once, because
//     it silently disables every limit below.
//   * LAZY. The Redis client is built on first use, not at import time, so
//     merely importing this module (e.g. during `next build`) never needs
//     credentials.
//
// KEYS. The email-keyed limiters (login / signup / reset / resend) protect a
// single mailbox or account. They do NOT stop one client working through many
// accounts — password spraying, or signing up thousands of throwaway
// addresses to bomb Resend — which is what the *Ip* limiters are for. Both
// apply, IP first (cheaper to reject a flood). IPv6 callers are keyed by /64;
// see lib/http/client-ip.ts.

import { Ratelimit, type Duration } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

export interface LimitResult {
  success: boolean;
  /** Epoch ms when the window frees up, when Upstash reported it. */
  reset?: number;
}

export interface Limiter {
  limit(key: string): Promise<LimitResult>;
}

const LIMIT_TIMEOUT_MS = 1500;

let redis: Redis | null | undefined;
const warned = new Set<string>();

function warnOnce(id: string, message: string, err?: unknown): void {
  if (warned.has(id)) return;
  warned.add(id);
  if (err) console.error(`[rate-limit] ${message}`, err);
  else console.error(`[rate-limit] ${message}`);
}

function getRedis(): Redis | null {
  if (redis !== undefined) return redis;

  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    warnOnce(
      'no-redis',
      process.env.NODE_ENV === 'production'
        ? 'UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN are not set — ALL rate limits are DISABLED.'
        : 'Upstash is not configured — rate limits are skipped in this environment.',
    );
    redis = null;
    return redis;
  }

  // Upstash's defaults are 5 retries with exponential backoff (~4s in total)
  // and a 5s Ratelimit timeout — so a slow or unreachable Upstash would stall
  // every login for several seconds before failing open. One quick retry and a
  // tight timeout keep the worst case to ~1.5s.
  redis = new Redis({ url, token, retry: { retries: 1, backoff: () => 100 } });
  return redis;
}

function makeLimiter(prefix: string, tokens: number, window: Duration): Limiter {
  let inner: Ratelimit | null | undefined;

  return {
    async limit(key: string): Promise<LimitResult> {
      try {
        if (inner === undefined) {
          const client = getRedis();
          inner = client
            ? new Ratelimit({
                redis: client,
                limiter: Ratelimit.slidingWindow(tokens, window),
                prefix,
                // Allow the request through if Upstash hasn't answered by then.
                timeout: LIMIT_TIMEOUT_MS,
              })
            : null;
        }
        if (!inner) return { success: true };

        const res = await inner.limit(key);
        return { success: res.success, reset: res.reset };
      } catch (err) {
        warnOnce(`fail-open:${prefix}`, `${prefix} check failed — allowing the request (fail-open).`, err);
        return { success: true };
      }
    },
  };
}

/**
 * Runs each [limiter, key] in order and returns false at the first refusal.
 * A null/empty key is skipped — that is how "no trustworthy client IP" turns
 * an IP limiter into a no-op rather than throttling everyone into a single
 * shared "unknown" bucket.
 */
export async function checkLimits(
  checks: Array<[Limiter, string | null | undefined]>,
): Promise<boolean> {
  for (const [limiter, key] of checks) {
    if (!key) continue;
    const { success } = await limiter.limit(key);
    if (!success) return false;
  }
  return true;
}

/* ------------------------------------------------------------------ *
 * Per-email (unchanged windows and prefixes, so live counters carry over)
 * ------------------------------------------------------------------ */

// 5 attempts per 60s per email — tight enough to blunt credential stuffing
// against one account, loose enough that a real user fat-fingering their
// password twice never notices.
export const loginRateLimit = makeLimiter('ratelimit:login', 5, '60 s');

export const signupRateLimit = makeLimiter('ratelimit:signup', 3, '60 s');

// Keyed by email (lowercased): stops the failure mode that matters here —
// spamming reset emails at one person's inbox.
export const resetPasswordRateLimit = makeLimiter('ratelimit:reset-password', 3, '300 s');

// Same shape as resetPasswordRateLimit, separate prefix/bucket. Deliberately
// its own limiter rather than reusing signupRateLimit or resetPasswordRateLimit
// — it is called from three different call sites (VerifyForm's expired-link
// fallback, LoginForm's "please verify your email" fallback, and
// signupAction's existing-unverified-account branch) and none of those should
// share a budget with, or be starved by, unrelated signup/reset traffic.
export const resendVerificationRateLimit = makeLimiter('ratelimit:resend-verification', 3, '300 s');

/* ------------------------------------------------------------------ *
 * Per-IP — closes the "many emails from one client" gap
 * ------------------------------------------------------------------ */

// 20/min per IP: several people behind one office NAT can all log in, but
// spraying one password across a list of emails is throttled hard.
export const loginIpRateLimit = makeLimiter('ratelimit:login-ip', 20, '60 s');

// Each accepted signup sends an email through Resend, so this is the one that
// protects cost and sender reputation.
export const signupIpRateLimit = makeLimiter('ratelimit:signup-ip', 5, '600 s');

export const resetPasswordIpRateLimit = makeLimiter('ratelimit:reset-password-ip', 5, '600 s');

export const resendVerificationIpRateLimit = makeLimiter('ratelimit:resend-verification-ip', 5, '600 s');

/* ------------------------------------------------------------------ *
 * Per-user — authenticated API routes (keyed by user id, not IP: a signed-in
 * account is a stronger identity than an address, and it can't be rotated
 * around by a proxy pool)
 * ------------------------------------------------------------------ */

// Every upload costs a signed Blob token; a batch is capped at 20 files, so
// 60 per 10 minutes leaves room for a few full batches.
export const uploadSignRateLimit = makeLimiter('ratelimit:upload-sign', 60, '600 s');

// Poster/snapshot captures fire automatically as cards go live — a fast
// scroll can legitimately trigger dozens in a minute — so this is generous
// on purpose. It exists to stop scripted abuse, not to shape normal use.
export const posterWriteRateLimit = makeLimiter('ratelimit:poster-write', 120, '60 s');
