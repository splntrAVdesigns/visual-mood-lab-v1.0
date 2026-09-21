/**
 * Sprint A security-guard verifier.
 *
 * Run with: npm run verify:security
 *
 * Deterministic, no network, no database, no Next.js. It exercises the pure
 * decision logic behind each Sprint A fix:
 *
 *   1. lib/http/client-ip.ts        — where a rate-limit key comes from
 *   2. lib/security/seed-guard.ts   — who may call POST /api/seed
 *   3. lib/validation/poster.ts     — what may be stored as a poster
 *   4. lib/auth/rate-limit.ts       — the fail-open / skip-null-key behaviour
 *
 * Exits non-zero on the first failing group so it can gate a commit.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';

import { clientIpFromHeaders, clientIpKey, ipRateLimitKey } from '../lib/http/client-ip';
import {
  describeSeedAuthFailure,
  evaluateSeedRequest,
  isFlagOn,
  MIN_SEED_SECRET_LENGTH,
  type SeedRequestFacts,
} from '../lib/security/seed-guard';
import {
  hasPngSignature,
  isPlaceholderPosterUrl,
  MAX_POSTER_DIMENSION,
  posterWriteMode,
  readPngDimensions,
  validatePosterBytes,
} from '../lib/validation/poster';
import { checkLimits, loginIpRateLimit, type Limiter } from '../lib/auth/rate-limit';

let passed = 0;
let failed = 0;

function check(name: string, condition: boolean, detail?: unknown): void {
  if (condition) {
    passed++;
  } else {
    failed++;
    console.error(`  FAIL  ${name}${detail !== undefined ? `  -> ${JSON.stringify(detail)}` : ''}`);
  }
}

function group(title: string): void {
  console.log(`\n${title}`);
}

function headers(map: Record<string, string>): { get(name: string): string | null } {
  const lower = Object.fromEntries(Object.entries(map).map(([k, v]) => [k.toLowerCase(), v]));
  return { get: (name: string) => lower[name.toLowerCase()] ?? null };
}

/* ------------------------------------------------------------------ *
 * 1. Client IP
 * ------------------------------------------------------------------ */

function verifyClientIp(): void {
  group('client-ip');

  check('no headers -> null', clientIpFromHeaders(headers({})) === null);
  check('null reader -> null', clientIpFromHeaders(null) === null);

  check(
    'x-vercel-forwarded-for wins over x-forwarded-for',
    clientIpFromHeaders(headers({ 'x-vercel-forwarded-for': '203.0.113.7', 'x-forwarded-for': '198.51.100.1' })) ===
      '203.0.113.7',
  );
  check(
    'x-real-ip beats x-forwarded-for',
    clientIpFromHeaders(headers({ 'x-real-ip': '203.0.113.8', 'x-forwarded-for': '198.51.100.1' })) === '203.0.113.8',
  );
  check(
    'x-forwarded-for uses the leftmost hop',
    clientIpFromHeaders(headers({ 'x-forwarded-for': '203.0.113.9, 10.0.0.1, 10.0.0.2' })) === '203.0.113.9',
  );
  check('port stripped from IPv4', clientIpFromHeaders(headers({ 'x-real-ip': '203.0.113.10:51234' })) === '203.0.113.10');
  check('brackets + port stripped from IPv6', clientIpFromHeaders(headers({ 'x-real-ip': '[2001:db8::1]:443' })) === '2001:db8::1');
  check('garbage rejected', clientIpFromHeaders(headers({ 'x-forwarded-for': 'not-an-ip' })) === null);
  check('SQL-ish junk rejected', clientIpFromHeaders(headers({ 'x-forwarded-for': "1.2.3.4'; DROP TABLE users;--" })) === null);
  check(
    'a bad first candidate falls through to a good one',
    clientIpFromHeaders(headers({ 'x-vercel-forwarded-for': 'garbage', 'x-real-ip': '203.0.113.11' })) === '203.0.113.11',
  );

  check('IPv4 key is unchanged', ipRateLimitKey('203.0.113.7') === '203.0.113.7');
  check(
    'IPv6 keyed by /64 — two hosts in one /64 share a bucket',
    ipRateLimitKey('2001:db8:aaaa:bbbb:1::1') === ipRateLimitKey('2001:db8:aaaa:bbbb:ffff:ffff:ffff:ffff'),
    [ipRateLimitKey('2001:db8:aaaa:bbbb:1::1'), ipRateLimitKey('2001:db8:aaaa:bbbb:ffff:ffff:ffff:ffff')],
  );
  check(
    'IPv6 in different /64s stay separate',
    ipRateLimitKey('2001:db8:aaaa:bbbb::1') !== ipRateLimitKey('2001:db8:aaaa:bbbc::1'),
  );
  check('compressed and expanded forms agree', ipRateLimitKey('2001:db8::1') === ipRateLimitKey('2001:0db8:0000:0000:0000:0000:0000:0001'));
  check('IPv4-mapped IPv6 collapses to the IPv4', ipRateLimitKey('::ffff:203.0.113.7') === '203.0.113.7');
  check('IPv4-mapped (hex form) collapses to the IPv4', ipRateLimitKey('::ffff:cb00:7107') === '203.0.113.7', ipRateLimitKey('::ffff:cb00:7107'));
  check('loopback ::1 is a valid key', typeof ipRateLimitKey('::1') === 'string');
  check('clientIpKey composes both', clientIpKey(headers({ 'x-real-ip': '2001:db8:1:2:3:4:5:6' })) === '2001:0db8:0001:0002::/64');
  check('clientIpKey with no IP is null', clientIpKey(headers({})) === null);
}

/* ------------------------------------------------------------------ *
 * 2. Seed guard
 * ------------------------------------------------------------------ */

function verifySeedGuard(): void {
  group('seed-guard');

  const SECRET = 'a'.repeat(MIN_SEED_SECRET_LENGTH) + 'XYZ';
  const base: SeedRequestFacts = {
    nodeEnv: 'production',
    allowSeedRoute: '1',
    adminSecret: SECRET,
    authorization: `Bearer ${SECRET}`,
    origin: null,
    host: 'app.example.com',
    fresh: false,
  };
  const decide = (over: Partial<SeedRequestFacts>) => evaluateSeedRequest({ ...base, ...over });

  check('flag parsing', isFlagOn('1') && isFlagOn('true') && !isFlagOn('') && !isFlagOn('0') && !isFlagOn('false') && !isFlagOn('OFF') && !isFlagOn(undefined));

  // Production
  check('prod: correct secret + flag -> ok', decide({}).ok === true);
  const disabled = decide({ allowSeedRoute: undefined });
  check('prod: flag unset -> 403', !disabled.ok && disabled.status === 403);
  const zero = decide({ allowSeedRoute: '0' });
  check('prod: ALLOW_SEED_ROUTE=0 -> 403 (was treated as ON before)', !zero.ok && zero.status === 403);
  const noSecretCfg = decide({ adminSecret: undefined });
  check('prod: secret not configured -> 403 (fail closed)', !noSecretCfg.ok && noSecretCfg.status === 403);
  const short = decide({ adminSecret: 'short', authorization: 'Bearer short' });
  check('prod: secret too short -> 403', !short.ok && short.status === 403);
  const noAuth = decide({ authorization: null });
  check('prod: no Authorization header -> 401', !noAuth.ok && noAuth.status === 401);
  const wrong = decide({ authorization: `Bearer ${'b'.repeat(SECRET.length)}` });
  check('prod: wrong secret (same length) -> 401', !wrong.ok && wrong.status === 401);
  const wrongLen = decide({ authorization: 'Bearer nope' });
  check('prod: wrong secret (different length) -> 401', !wrongLen.ok && wrongLen.status === 401);
  const notBearer = decide({ authorization: `Basic ${SECRET}` });
  check('prod: non-Bearer scheme -> 401', !notBearer.ok && notBearer.status === 401);
  check('prod: "bearer" scheme is case-insensitive', decide({ authorization: `bearer ${SECRET}` }).ok === true);
  const emptyBearer = decide({ authorization: 'Bearer ' });
  check('prod: empty bearer -> 401', !emptyBearer.ok && emptyBearer.status === 401);

  // fresh
  const freshAuthed = decide({ fresh: true });
  check('prod: fresh=1 with a VALID secret -> 403', !freshAuthed.ok && freshAuthed.status === 403);
  const freshAnon = decide({ fresh: true, authorization: null });
  check('prod: fresh=1 without a secret -> 401, not 403 (reveals nothing)', !freshAnon.ok && freshAnon.status === 401);

  // Origin
  check('same-origin Origin header is fine', decide({ origin: 'https://app.example.com' }).ok === true);
  const crossOrigin = decide({ origin: 'https://evil.example' });
  check('cross-origin Origin -> 403', !crossOrigin.ok && crossOrigin.status === 403);
  const badOrigin = decide({ origin: 'not a url' });
  check('unparseable Origin -> 403', !badOrigin.ok && badOrigin.status === 403);
  const nullOrigin = decide({ origin: 'null' });
  check('"null" Origin (sandboxed iframe) -> 403', !nullOrigin.ok && nullOrigin.status === 403);

  // Development
  const dev = (over: Partial<SeedRequestFacts>) =>
    evaluateSeedRequest({ ...base, nodeEnv: 'development', allowSeedRoute: undefined, adminSecret: undefined, authorization: null, ...over });
  check('dev: open with no config', dev({}).ok === true);
  check('dev: fresh allowed', dev({ fresh: true }).ok === true);
  const devSecretNoAuth = dev({ adminSecret: SECRET });
  check('dev: secret set but not supplied -> 401', !devSecretNoAuth.ok && devSecretNoAuth.status === 401);
  check('dev: secret set and supplied -> ok', dev({ adminSecret: SECRET, authorization: `Bearer ${SECRET}` }).ok === true);
  const devCross = dev({ origin: 'https://evil.example' });
  check('dev: cross-origin still blocked (CSRF against localhost)', !devCross.ok && devCross.status === 403);
  // --- The configured secret is trimmed like the caller's token. A value pasted
  // into a dashboard can carry a stray space / trailing newline; with only one
  // side trimmed it could never match, and the failure looked like a wrong secret.
  for (const [label, stored] of [
    ['a trailing newline', `${SECRET}\n`],
    ['a trailing CRLF', `${SECRET}\r\n`],
    ['leading and trailing spaces', `  ${SECRET}  `],
    ['a leading tab', `\t${SECRET}`],
  ] as const) {
    check(`prod: a stored secret with ${label} still matches the clean token`, decide({ adminSecret: stored }).ok === true);
  }
  check('prod: a token with surrounding whitespace still matches too', decide({ authorization: `Bearer   ${SECRET}  ` }).ok === true);
  const ws = decide({ adminSecret: '   \n\t  ' });
  check('prod: a whitespace-only secret counts as NOT configured (403)', !ws.ok && ws.status === 403 && /not configured/.test(ws.error));
  const padded = decide({ adminSecret: ' '.repeat(10) + 'a'.repeat(MIN_SEED_SECRET_LENGTH - 1) });
  check('prod: the 24-char minimum applies AFTER trimming (padding cannot fake length)', !padded.ok && padded.status === 403);
  check('prod: exactly the minimum after trimming is accepted', decide({ adminSecret: ` ${'b'.repeat(MIN_SEED_SECRET_LENGTH)}\n`, authorization: `Bearer ${'b'.repeat(MIN_SEED_SECRET_LENGTH)}` }).ok === true);
  for (const [label, token] of [['one character off', SECRET.slice(0, -1) + 'Q'], ['a prefix', SECRET.slice(0, -1)], ['with an extra character', `${SECRET}x`], ['the wrong case', SECRET.toLowerCase()], ['empty', '']] as const) {
    const wrong = decide({ adminSecret: `${SECRET}\n`, authorization: `Bearer ${token}` });
    check(`prod: trimming did not weaken anything — a token that is ${label} -> 401`, !wrong.ok && wrong.status === 401);
  }

  // --- describeSeedAuthFailure: explains a 401 in the SERVER LOG without ever containing a value.
  const tokenSeen = 'Z'.repeat(30);
  const cases: Array<[string, Parameters<typeof describeSeedAuthFailure>[0], RegExp[]]> = [
    ['no header', { adminSecret: SECRET, authorization: null }, [/server secret: 27 chars/, /no Authorization header/]],
    ['not a bearer header', { adminSecret: SECRET, authorization: 'Basic abc' }, [/not "Bearer <token>"/]],
    ['secret not set', { adminSecret: undefined, authorization: `Bearer ${tokenSeen}` }, [/server secret: not set/, /bearer token 30 chars/]],
    ['different lengths', { adminSecret: SECRET, authorization: `Bearer ${tokenSeen}` }, [/server secret: 27 chars/, /bearer token 30 chars/, /different lengths/]],
    ['same length, different characters', { adminSecret: SECRET, authorization: `Bearer ${'Q'.repeat(SECRET.length)}` }, [/same length but different characters/]],
    ['stray whitespace in the stored value', { adminSecret: `${SECRET}\n`, authorization: `Bearer ${tokenSeen}` }, [/1 stray whitespace char, ignored/]],
    ['several stray characters', { adminSecret: `  ${SECRET}\r\n`, authorization: `Bearer ${tokenSeen}` }, [/4 stray whitespace chars, ignored/]],
  ];
  for (const [label, facts, expected] of cases) {
    const text = describeSeedAuthFailure(facts);
    check(`log line (${label}) says what it should`, expected.every((re) => re.test(text)), text);
    check(`log line (${label}) never contains the secret or the token`, !text.includes(SECRET) && !text.includes(tokenSeen) && !text.includes('QQQQ') && !text.includes('a'.repeat(12)), text);
  }
  check('the response to the caller is still a bare "Unauthorized" (the detail stays in the log)', (() => { const r = decide({ authorization: `Bearer ${tokenSeen}` }); return !r.ok && r.status === 401 && r.error === 'Unauthorized'; })());

  // --- wiring: the route logs the description on a 401 and never returns it.
  const routeSrc = readFileSync(join(process.cwd(), 'app/api/seed/route.ts'), 'utf8');
  check('route: a 401 writes describeSeedAuthFailure(...) to the server log', /decision\.status === 401\)\s*console\.warn\([^)]*describeSeedAuthFailure\(facts\)/.test(routeSrc));
  check('route: the description is never placed in the response body', !/NextResponse\.json\([^)]*describeSeedAuthFailure/s.test(routeSrc));
  check('route: the response body is still only decision.error', /\{ error: decision\.error \}/.test(routeSrc));

  check('test env behaves like dev', evaluateSeedRequest({ ...base, nodeEnv: 'test', allowSeedRoute: undefined, adminSecret: undefined, authorization: null }).ok === true);
}

/* ------------------------------------------------------------------ *
 * 3. Poster validation
 * ------------------------------------------------------------------ */

async function realPng(width: number, height: number): Promise<Uint8Array> {
  // Gaussian noise so the encoded file comfortably clears the 2 KB floor.
  const buf = await sharp({
    create: { width, height, channels: 3, background: { r: 40, g: 40, b: 40 }, noise: { type: 'gaussian', mean: 128, sigma: 60 } },
  })
    .png()
    .toBuffer();
  return new Uint8Array(buf);
}

function forgePngHeader(width: number, height: number, totalBytes: number): Uint8Array {
  const bytes = new Uint8Array(totalBytes);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  const view = new DataView(bytes.buffer);
  view.setUint32(8, 13);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12); // IHDR
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

async function verifyPoster(): Promise<void> {
  group('poster-validation');

  const png = await realPng(96, 64);
  check('fixture is a real PNG > 2KB', png.byteLength > 2048 && hasPngSignature(png), png.byteLength);

  const dims = readPngDimensions(png);
  check('IHDR dimensions read correctly', dims?.width === 96 && dims?.height === 64, dims);

  const ok = validatePosterBytes(png);
  check('real PNG accepted', ok.ok && ok.width === 96 && ok.height === 64);

  // The exact abuse this fix targets: any bytes stored as image/png.
  const jpegLike = new Uint8Array(4096);
  jpegLike.set([0xff, 0xd8, 0xff, 0xe0]);
  const notPng = validatePosterBytes(jpegLike);
  check('JPEG bytes -> 415', !notPng.ok && notPng.status === 415, notPng);

  const svgBytes = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg">'.padEnd(4096, ' '));
  const asSvg = validatePosterBytes(svgBytes);
  check('SVG (script-capable) bytes -> 415', !asSvg.ok && asSvg.status === 415);

  const zeros = validatePosterBytes(new Uint8Array(4096));
  check('all-zero body -> 415', !zeros.ok && zeros.status === 415);

  const tiny = validatePosterBytes(png.subarray(0, 100));
  check('too small -> 422 (message unchanged)', !tiny.ok && tiny.status === 422 && tiny.error === 'Capture too small, ignored', tiny);

  const huge = validatePosterBytes(png, 1000);
  check('over the ceiling -> 413 (message unchanged)', !huge.ok && huge.status === 413 && huge.error === 'Capture too large', huge);

  const sigOnly = new Uint8Array(4096);
  sigOnly.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const noIhdr = validatePosterBytes(sigOnly);
  check('signature with no IHDR -> 422', !noIhdr.ok && noIhdr.status === 422, noIhdr);

  const bomb = validatePosterBytes(forgePngHeader(100_000, 100_000, 4096));
  check('forged IHDR claiming 100000x100000 -> 422', !bomb.ok && bomb.status === 422, bomb);

  const zeroDim = validatePosterBytes(forgePngHeader(0, 64, 4096));
  check('zero-width IHDR -> 422', !zeroDim.ok && zeroDim.status === 422);

  const edge = validatePosterBytes(forgePngHeader(MAX_POSTER_DIMENSION, MAX_POSTER_DIMENSION, 4096));
  check('exactly the max dimension is accepted', edge.ok, edge);
  const over = validatePosterBytes(forgePngHeader(MAX_POSTER_DIMENSION + 1, 64, 4096));
  check('one past the max dimension -> 422', !over.ok && over.status === 422);

  // A Uint8Array view with a non-zero byteOffset (how a Node Buffer slice looks) must still parse.
  const padded = new Uint8Array(png.byteLength + 16);
  padded.set(png, 16);
  const viewAtOffset = padded.subarray(16);
  check('IHDR read respects byteOffset', readPngDimensions(viewAtOffset)?.width === 96);

  // Placeholder detection — must agree with lib/persist/client.ts's isPlaceholderPoster.
  check('placeholder: .svg', isPlaceholderPosterUrl('/uploads/posters/x.svg'));
  check('placeholder: empty / null / undefined', isPlaceholderPosterUrl('') && isPlaceholderPosterUrl(null) && isPlaceholderPosterUrl(undefined));
  check('placeholder: .SVG with a query string', isPlaceholderPosterUrl('https://b/x.SVG?v=2'));
  check('real poster: .png is NOT a placeholder', !isPlaceholderPosterUrl('https://b/posters/x.png'));
  check('real poster: unique-suffix .png is NOT a placeholder', !isPlaceholderPosterUrl('https://b/posters/x.1a2b3c4d5e6f.png'));

  // Who may write which poster.
  const LIB = 'library';
  const mode = (ownerId: string, userId: string, url: string | null) =>
    posterWriteMode({ ownerId, userId, libraryOwnerId: LIB, currentPosterUrl: url });
  check('own asset -> own', mode('u1', 'u1', 'https://b/p.png') === 'own');
  check('library asset, placeholder -> shared-first-capture', mode(LIB, 'u1', '/uploads/posters/a.svg') === 'shared-first-capture');
  check('library asset, no poster -> shared-first-capture', mode(LIB, 'u1', null) === 'shared-first-capture');
  check('library asset, real poster -> shared-locked', mode(LIB, 'u1', 'https://b/posters/a.png') === 'shared-locked');
  check("someone else's asset -> forbidden", mode('u2', 'u1', '/x.svg') === 'forbidden');
  check("someone else's real-poster asset -> forbidden", mode('u2', 'u1', 'https://b/p.png') === 'forbidden');
}

/* ------------------------------------------------------------------ *
 * 4. Rate-limit wrapper behaviour
 * ------------------------------------------------------------------ */

async function verifyRateLimit(): Promise<void> {
  group('rate-limit');

  const calls: string[] = [];
  const stub = (label: string, allow: boolean): Limiter => ({
    async limit(key: string) {
      calls.push(`${label}:${key}`);
      return { success: allow };
    },
  });

  calls.length = 0;
  check('all pass -> true', (await checkLimits([[stub('ip', true), '1.2.3.4'], [stub('email', true), 'a@b.c']])) === true);
  check('both limiters were consulted, IP first', calls.join(',') === 'ip:1.2.3.4,email:a@b.c', calls);

  calls.length = 0;
  check('IP refusal -> false', (await checkLimits([[stub('ip', false), '1.2.3.4'], [stub('email', true), 'a@b.c']])) === false);
  check('IP refusal short-circuits (email bucket not consumed)', calls.join(',') === 'ip:1.2.3.4', calls);

  calls.length = 0;
  check('email refusal -> false', (await checkLimits([[stub('ip', true), '1.2.3.4'], [stub('email', false), 'a@b.c']])) === false);

  calls.length = 0;
  check(
    'null IP key is SKIPPED, not lumped into a shared bucket',
    (await checkLimits([[stub('ip', false), null], [stub('email', true), 'a@b.c']])) === true && calls.join(',') === 'email:a@b.c',
    calls,
  );
  check('undefined / empty keys are skipped too', (await checkLimits([[stub('x', false), undefined], [stub('y', false), '']])) === true);

  // The real wrapper with no Upstash configured: must allow, never throw.
  const savedUrl = process.env.UPSTASH_REDIS_REST_URL;
  const savedToken = process.env.UPSTASH_REDIS_REST_TOKEN;
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
  const origError = console.error;
  const logged: string[] = [];
  console.error = (...args: unknown[]) => void logged.push(args.map(String).join(' '));
  try {
    const res = await loginIpRateLimit.limit('1.2.3.4');
    check('unconfigured Upstash -> allowed (fail-open), no throw', res.success === true);
    check('unconfigured Upstash -> warned', logged.some((l) => l.includes('Upstash is not configured') || l.includes('DISABLED')), logged);
  } finally {
    console.error = origError;
    if (savedUrl !== undefined) process.env.UPSTASH_REDIS_REST_URL = savedUrl;
    if (savedToken !== undefined) process.env.UPSTASH_REDIS_REST_TOKEN = savedToken;
  }
}

/* ------------------------------------------------------------------ */

async function main(): Promise<void> {
  verifyClientIp();
  verifySeedGuard();
  await verifyPoster();
  await verifyRateLimit();

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
