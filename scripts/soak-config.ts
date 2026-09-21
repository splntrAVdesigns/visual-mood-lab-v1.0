// scripts/soak-config.ts
//
// Reads the soak test's configuration from environment variables and
// validates it, so a typo fails loudly before a 20-minute run rather than
// silently after it. Pure — no I/O — so scripts/verify-soak.ts can test it.

import { DEFAULT_THRESHOLDS, type Thresholds } from './soak-analysis';

export type TileSelection =
  | { mode: 'all' }
  | { mode: 'count'; n: number }
  | { mode: 'kind'; kind: 'shader' | 'sketch' };

export interface SoakConfig {
  url: string;
  cycles: number;
  tiles: TileSelection;
  /** Case-insensitive title fragments; when set, only tiles matching one are exercised. */
  only: string[];
  holdMs: number;
  settleMs: number;
  focusTimeoutMs: number;
  headless: boolean;
  mobile: boolean;
  /** Software GL (SwiftShader) — for machines and CI without a GPU. */
  softwareGl: boolean;
  chromePath: string | null;
  email: string | null;
  password: string | null;
  cookieValue: string | null;
  cookieName: string;
  reportPath: string;
  thresholds: Thresholds;
}

export type ConfigResult = { ok: true; config: SoakConfig } | { ok: false; errors: string[] };

type Env = Record<string, string | undefined>;

const truthy = (v: string | undefined, dflt: boolean): boolean => {
  if (v === undefined || v.trim() === '') return dflt;
  return !['0', 'false', 'no', 'off'].includes(v.trim().toLowerCase());
};

export function parseConfig(env: Env): ConfigResult {
  const errors: string[] = [];
  const num = (name: string, dflt: number, min: number, max: number): number => {
    const raw = env[name];
    if (raw === undefined || raw.trim() === '') return dflt;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < min || n > max) {
      errors.push(`${name} must be a number from ${min} to ${max} (got "${raw}")`);
      return dflt;
    }
    return n;
  };

  let url = (env.SOAK_URL ?? 'http://localhost:3000').trim();
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('protocol');
    url = u.origin;
  } catch {
    errors.push(`SOAK_URL must be an http(s) URL (got "${env.SOAK_URL}")`);
  }

  let tiles: TileSelection = { mode: 'all' };
  const rawTiles = (env.SOAK_TILES ?? 'all').trim().toLowerCase();
  if (rawTiles === 'shader' || rawTiles === 'sketch') tiles = { mode: 'kind', kind: rawTiles };
  else if (rawTiles !== 'all' && rawTiles !== '') {
    const n = Number(rawTiles);
    if (Number.isInteger(n) && n >= 1) tiles = { mode: 'count', n };
    else errors.push(`SOAK_TILES must be "all", "shader", "sketch" or a whole number of tiles (got "${env.SOAK_TILES}")`);
  }

  const cookieValue = env.SOAK_SESSION_COOKIE?.trim() || null;
  const email = env.SOAK_EMAIL?.trim() || null;
  const password = env.SOAK_PASSWORD ?? null;
  if (!cookieValue && !(email && password)) {
    errors.push('sign-in is required: set SOAK_EMAIL and SOAK_PASSWORD, or SOAK_SESSION_COOKIE');
  }

  const thresholds: Thresholds = { ...DEFAULT_THRESHOLDS };
  thresholds.heapSlopeMBPerCycle = num('SOAK_MAX_HEAP_SLOPE', DEFAULT_THRESHOLDS.heapSlopeMBPerCycle, 0, 10000);
  thresholds.heapGrowthMB = num('SOAK_MAX_HEAP_GROWTH', DEFAULT_THRESHOLDS.heapGrowthMB, 0, 100000);

  const config: SoakConfig = {
    url,
    cycles: Math.floor(num('SOAK_CYCLES', 3, 1, 1000)),
    tiles,
    only: (env.SOAK_ONLY ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
    holdMs: num('SOAK_HOLD_MS', 700, 0, 60000),
    settleMs: num('SOAK_SETTLE_MS', 300, 0, 60000),
    focusTimeoutMs: num('SOAK_FOCUS_TIMEOUT_MS', 20000, 1000, 300000),
    headless: truthy(env.SOAK_HEADLESS, true),
    mobile: truthy(env.SOAK_MOBILE, false),
    softwareGl: truthy(env.SOAK_SOFTWARE_GL, false),
    chromePath: env.SOAK_CHROME?.trim() || null,
    email,
    password,
    cookieValue,
    cookieName: env.SOAK_COOKIE_NAME?.trim() || (url.startsWith('https:') ? '__Secure-authjs.session-token' : 'authjs.session-token'),
    reportPath: env.SOAK_REPORT?.trim() || 'soak-report.json',
    thresholds,
  };
  return errors.length ? { ok: false, errors } : { ok: true, config };
}
