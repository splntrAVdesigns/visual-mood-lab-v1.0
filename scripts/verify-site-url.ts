/**
 * Public-URL verifier (lib/site.ts).
 *
 * Run with: npm run verify:site-url
 *
 * siteUrl() feeds Next's `metadataBase`, which is evaluated while EVERY page's
 * metadata is built — so it must (a) pick the right origin, and (b) never throw,
 * whatever is in the environment. Also guards the wiring: an Open Graph image
 * with no `metadataBase` is exactly what produced the
 * "metadataBase property in metadata export is not set" build warning.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { siteUrl, toOrigin } from '../lib/site';

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean, detail?: unknown): void {
  if (ok) passed++;
  else {
    failed++;
    process.stderr.write(`  FAIL  ${name}${detail !== undefined ? `  -> ${JSON.stringify(detail)}` : ''}\n`);
  }
}
const group = (t: string) => console.log(`\n${t}`);
const site = (env: Record<string, string | undefined>) => siteUrl(env).href;

// A quiet console: the "APP_URL is unusable" warning is expected in some cases below.
const realWarn = console.warn;
let warnings = 0;
console.warn = () => { warnings++; };

group('precedence');
check('nothing set -> http://localhost:3000', site({}) === 'http://localhost:3000/');
check('APP_URL is used', site({ APP_URL: 'https://mood.example.com' }) === 'https://mood.example.com/');
check('APP_URL beats every Vercel variable', site({ APP_URL: 'https://mine.example', VERCEL_ENV: 'production', VERCEL_PROJECT_PRODUCTION_URL: 'prod.vercel.app', VERCEL_URL: 'x.vercel.app' }) === 'https://mine.example/');
check('production: the production domain beats the per-deployment URL', site({ VERCEL_ENV: 'production', VERCEL_PROJECT_PRODUCTION_URL: 'mood.example.com', VERCEL_URL: 'app-abc123.vercel.app' }) === 'https://mood.example.com/');
check('production without a VERCEL_ENV still prefers the production domain', site({ VERCEL_PROJECT_PRODUCTION_URL: 'mood.example.com', VERCEL_URL: 'app-abc123.vercel.app' }) === 'https://mood.example.com/');
check('PREVIEW: the deployment URL wins, so a preview links to itself', site({ VERCEL_ENV: 'preview', VERCEL_PROJECT_PRODUCTION_URL: 'mood.example.com', VERCEL_URL: 'app-git-feature.vercel.app' }) === 'https://app-git-feature.vercel.app/');
check('preview with only the production domain falls back to it', site({ VERCEL_ENV: 'preview', VERCEL_PROJECT_PRODUCTION_URL: 'mood.example.com' }) === 'https://mood.example.com/');
check('only VERCEL_URL is set -> that', site({ VERCEL_URL: 'app-abc123.vercel.app' }) === 'https://app-abc123.vercel.app/');
check('Vercel variables (which have no scheme) get https://', site({ VERCEL_PROJECT_PRODUCTION_URL: 'x.vercel.app' }).startsWith('https://'));

group('normalisation');
check('a trailing slash is dropped', site({ APP_URL: 'https://mood.example.com/' }) === 'https://mood.example.com/' && siteUrl({ APP_URL: 'https://mood.example.com/' }).pathname === '/');
check('a path is dropped (the app is served from the root)', site({ APP_URL: 'https://mood.example.com/some/path?x=1#y' }) === 'https://mood.example.com/');
check('a port is kept', site({ APP_URL: 'https://mood.example.com:8443' }) === 'https://mood.example.com:8443/');
check('a bare host gets https://', site({ APP_URL: 'mood.example.com' }) === 'https://mood.example.com/');
check('a bare localhost gets http:// (not https)', site({ APP_URL: 'localhost:3000' }) === 'http://localhost:3000/' && site({ APP_URL: 'localhost:4000' }) === 'http://localhost:4000/' && site({ APP_URL: '127.0.0.1:3000' }) === 'http://127.0.0.1:3000/');
check('a protocol-relative //host is read as https://host', site({ APP_URL: '//mood.example.com' }) === 'https://mood.example.com/' && site({ APP_URL: '///mood.example.com' }) === 'https://mood.example.com/');
check('an explicit http:// is respected', site({ APP_URL: 'http://staging.internal' }) === 'http://staging.internal/');
check('scheme and host are case-normalised', site({ APP_URL: 'HTTPS://Mood.Example.COM' }) === 'https://mood.example.com/');
check('surrounding whitespace is ignored', site({ APP_URL: '  https://mood.example.com  ' }) === 'https://mood.example.com/');
check('the result is a URL whose origin is what was asked for', siteUrl({ APP_URL: 'https://mood.example.com/x' }).origin === 'https://mood.example.com');

group('bad values fall through, they never win and never throw');
warnings = 0;
for (const bad of ['not a url', 'ftp://files.example.com', 'javascript:alert(1)', 'file:///etc/passwd', '://nope', 'https://', 'http://:80']) {
  check(`APP_URL=${JSON.stringify(bad)} is ignored`, ((): boolean => { try { return site({ APP_URL: bad }) === 'http://localhost:3000/'; } catch { return false; } })(), bad);
}
check('...and a usable Vercel value is still picked up behind a bad APP_URL', site({ APP_URL: 'not a url', VERCEL_PROJECT_PRODUCTION_URL: 'ok.vercel.app' }) === 'https://ok.vercel.app/');
check('a set-but-unusable APP_URL is reported (once), so a typo is not silent', warnings >= 1 && warnings <= 2, warnings);
warnings = 0;
check('unset / empty / whitespace values count as NOT set (no warning, no effect)', site({ APP_URL: '', VERCEL_URL: '   ' }) === 'http://localhost:3000/' && warnings === 0, warnings);

group('fuzz: whatever is in the environment, it never throws and always returns an http(s) origin');
{
  let seed = 0x51e;
  const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  const alphabet = ['h', 't', 'p', 's', ':', '/', '.', ' ', '-', '_', '@', '#', '?', '%', '[', ']', 'é', '0', '9', '\n', '\\', 'a', 'b', 'localhost', 'https://', 'http://', 'example.com', ':3000'];
  let bad = 0;
  let threw = 0;
  for (let i = 0; i < 4000; i++) {
    const word = () => Array.from({ length: Math.floor(rnd() * 8) }, () => alphabet[Math.floor(rnd() * alphabet.length)]).join('');
    const env = { APP_URL: rnd() < 0.7 ? word() : undefined, VERCEL_URL: rnd() < 0.5 ? word() : undefined, VERCEL_PROJECT_PRODUCTION_URL: rnd() < 0.5 ? word() : undefined, VERCEL_ENV: rnd() < 0.5 ? (rnd() < 0.5 ? 'preview' : 'production') : undefined };
    try {
      const u = siteUrl(env);
      if (!(u.protocol === 'http:' || u.protocol === 'https:') || !u.hostname || u.pathname !== '/' || u.search || u.hash) bad++;
    } catch {
      threw++;
    }
  }
  check('4,000 random environments: never throws', threw === 0, threw);
  check('...always an http(s) origin with a host and no path / query / hash', bad === 0, bad);
  check('toOrigin never throws on garbage either', (() => { try { for (let i = 0; i < 2000; i++) toOrigin(String.fromCharCode(...Array.from({ length: 12 }, () => Math.floor(rnd() * 200)))); return true; } catch { return false; } })());
}
console.warn = realWarn;

group('wiring: an Open Graph image needs a metadataBase');
{
  const root = process.cwd();
  const layout = readFileSync(join(root, 'app/layout.tsx'), 'utf8');
  const hasOgImage = ['opengraph-image.tsx', 'opengraph-image.png', 'opengraph-image.jpg'].some((f) => existsSync(join(root, 'app', f)));
  check('the app has an Open Graph image (so the rule below applies)', hasOgImage);
  check('app/layout.tsx sets metadataBase from siteUrl()', /metadataBase:\s*siteUrl\(\)/.test(layout));
  check('app/layout.tsx imports siteUrl from lib/site', /from '@\/lib\/site'/.test(layout));
  check('metadataBase is not hard-coded to a literal URL', !/metadataBase:\s*new URL\(\s*['"`]/.test(layout));
  const envExample = readFileSync(join(root, '.env.example'), 'utf8');
  check('APP_URL is documented in .env.example', /APP_URL=/.test(envExample));
  const verification = readFileSync(join(root, 'lib/auth/verification.ts'), 'utf8');
  check("the email links still use the SAME variable (APP_URL) — one source, not two", /process\.env\.APP_URL/.test(verification));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
