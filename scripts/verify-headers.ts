/**
 * Security-header verifier.
 *
 * Run with: npm run verify:headers
 *
 * Checks the header builders, the REAL next.config.ts output (rule order and
 * non-overlap matter — see lib/security/headers.ts), and the CSP report
 * normaliser, whose main job is to keep single-use tokens out of the logs.
 */

import config from '../next.config';
import {
  buildAppCsp,
  buildPermissionsPolicy,
  buildSandboxCsp,
  CSP_REPORT_PATH,
  securityHeaderRules,
} from '../lib/security/headers';
import { cleanUrl, MAX_REPORTS_PER_REQUEST, normalizeCspReports } from '../lib/security/csp-report';

let passed = 0;
let failed = 0;
function check(name: string, condition: boolean, detail?: unknown): void {
  if (condition) passed++;
  else {
    failed++;
    console.error(`  FAIL  ${name}${detail !== undefined ? `  -> ${JSON.stringify(detail)}` : ''}`);
  }
}
const group = (t: string) => console.log(`\n${t}`);

/** "a b; c d" -> { a: ['b'], c: ['d'] } */
function parse(csp: string): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const part of csp.split(';')) {
    const [name, ...vals] = part.trim().split(/\s+/);
    if (name) out[name] = vals;
  }
  return out;
}

async function main(): Promise<void> {
  group('app CSP');
  const app = parse(buildAppCsp({ dev: false }));
  check('default-src is self', app['default-src']?.join() === "'self'");
  check("production: NO 'unsafe-eval'", !app['script-src'].includes("'unsafe-eval'"), app['script-src']);
  check("production: no ws:/wss: in connect-src", !app['connect-src'].some((v) => v.startsWith('ws')));
  check("script-src keeps the documented 'unsafe-inline' concession", app['script-src'].includes("'unsafe-inline'"));
  check('blob store allowed for images and media', app['img-src'].includes('https://*.public.blob.vercel-storage.com') && app['media-src'].includes('https://*.public.blob.vercel-storage.com'));
  check('client-direct upload endpoint allowed in connect-src', app['connect-src'].includes('https://blob.vercel-storage.com'));
  check('data: and blob: allowed in connect-src (snapshot/poster capture fetch()es a data URL)', app['connect-src'].includes('data:') && app['connect-src'].includes('blob:'), app['connect-src']);
  check('object-src none', app['object-src']?.join() === "'none'");
  check('frame-ancestors none', app['frame-ancestors']?.join() === "'none'");
  check('base-uri self', app['base-uri']?.join() === "'self'");
  check('OAuth redirect targets allowed in form-action', app['form-action'].includes('https://github.com') && app['form-action'].includes('https://appleid.apple.com'));
  check('reports go to the report endpoint', app['report-uri']?.join() === CSP_REPORT_PATH && app['report-to']?.length === 1);
  check('no wildcard * script source', !app['script-src'].includes('*') && !app['script-src'].some((v) => v === 'https:' || v === 'http:'));
  const dev = parse(buildAppCsp({ dev: true }));
  check("dev: adds 'unsafe-eval' and websockets for HMR", dev['script-src'].includes("'unsafe-eval'") && dev['connect-src'].includes('ws:'));

  group('sandbox CSP');
  const sb = parse(buildSandboxCsp());
  check("default-src 'none'", sb['default-src']?.join() === "'none'");
  check('connect-src is data: ONLY — a sketch cannot reach any host (no exfiltration)', sb['connect-src']?.join() === 'data:', sb['connect-src']);
  check("connect-src has no host, no 'self', no wildcard", sb['connect-src'].every((v) => v === 'data:'));
  check("script-src has 'unsafe-eval' (the runtime evaluates sketch source)", sb['script-src'].includes("'unsafe-eval'"));
  check('script-src has no remote origin', sb['script-src'].every((v) => v.startsWith("'")), sb['script-src']);
  check('images/fonts/media are data: / blob: only', [sb['img-src'], sb['font-src'], sb['media-src']].every((l) => l.every((v) => v === 'data:' || v === 'blob:')));
  check('may be framed by the app itself, no one else', sb['frame-ancestors']?.join() === "'self'");
  check('no forms, no base-uri', sb['form-action']?.join() === "'none'" && sb['base-uri']?.join() === "'none'");

  group('permissions policy');
  const pp = buildPermissionsPolicy();
  check('camera is off', pp.includes('camera=()'));
  check('microphone is same-origin (audio-reactive tiles use it)', pp.includes('microphone=(self)'));
  check('MIDI and gamepad stay available same-origin', pp.includes('midi=(self)') && pp.includes('gamepad=(self)'));
  check('geolocation, display-capture, payment, usb, serial are off', ['geolocation=()', 'display-capture=()', 'payment=()', 'usb=()', 'serial=()'].every((f) => pp.includes(f)));
  check('fullscreen and clipboard-write stay same-origin', pp.includes('fullscreen=(self)') && pp.includes('clipboard-write=(self)'));

  group('rules from the REAL next.config.ts');
  const rules = (await config.headers!()) as Array<{ source: string; headers: Array<{ key: string; value: string }> }>;
  check('two rules', rules.length === 2, rules.map((r) => r.source));
  const [appRule, sbRule] = rules;
  const keys = (r: typeof appRule) => r.headers.map((h) => h.key);
  const val = (r: typeof appRule, k: string) => r.headers.find((h) => h.key === k)?.value;

  check('the app rule EXCLUDES /sandbox (no double CSP on the sandbox)', appRule.source.includes('(?!sandbox/)'), appRule.source);
  check('the sandbox rule targets /sandbox/*', sbRule.source === '/sandbox/:path*');
  for (const [label, r] of [['app', appRule], ['sandbox', sbRule]] as const) {
    check(`${label}: nosniff`, val(r, 'X-Content-Type-Options') === 'nosniff');
    check(`${label}: referrer policy`, val(r, 'Referrer-Policy') === 'strict-origin-when-cross-origin');
    check(`${label}: permissions policy`, val(r, 'Permissions-Policy') === pp);
    check(`${label}: reporting endpoint declared`, (val(r, 'Reporting-Endpoints') ?? '').includes(CSP_REPORT_PATH));
    check(`${label}: exactly ONE CSP header`, keys(r).filter((k) => k.startsWith('Content-Security-Policy')).length === 1, keys(r));
    check(`${label}: no header key set twice`, new Set(keys(r)).size === keys(r).length);
    check(`${label}: header values are single-line`, r.headers.every((h) => !/[\r\n]/.test(h.value)));
  }
  check('app is not frameable (DENY)', val(appRule, 'X-Frame-Options') === 'DENY');
  check('sandbox is frameable by its own origin only (SAMEORIGIN)', val(sbRule, 'X-Frame-Options') === 'SAMEORIGIN');
  check('rollout: the app policy starts as REPORT-ONLY', keys(appRule).includes('Content-Security-Policy-Report-Only'));
  check('rollout: the sandbox policy is ENFORCED (promoted after 44/44 sketches ran clean)', keys(sbRule).includes('Content-Security-Policy') && !keys(sbRule).includes('Content-Security-Policy-Report-Only'), keys(sbRule));

  const enforced = securityHeaderRules({ dev: false, appCspMode: 'enforce', sandboxCspMode: 'enforce' });
  check("'enforce' mode swaps in the enforcing header name", enforced.every((r) => r.headers.some((h) => h.key === 'Content-Security-Policy')) && enforced.every((r) => !r.headers.some((h) => h.key === 'Content-Security-Policy-Report-Only')));
  const mixed = securityHeaderRules({ dev: false, appCspMode: 'report-only', sandboxCspMode: 'enforce' });
  check('modes are independent (sandbox can be promoted first)', mixed[0].headers.some((h) => h.key === 'Content-Security-Policy-Report-Only') && mixed[1].headers.some((h) => h.key === 'Content-Security-Policy'));

  group('CSP report normalisation (log safety)');
  const legacy = normalizeCspReports({
    'csp-report': {
      'document-uri': 'https://app.example.com/verify?token=SECRETTOKEN123&x=1#frag',
      'effective-directive': 'script-src-elem',
      'blocked-uri': 'https://evil.example/x.js?key=SECRETKEY',
      'source-file': 'https://app.example.com/_next/static/chunks/a.js?v=99',
      'line-number': 12,
      disposition: 'report',
    },
  });
  check('legacy format parsed', legacy.length === 1 && legacy[0].directive === 'script-src-elem' && legacy[0].line === 12, legacy);
  const logged = JSON.stringify(legacy);
  check('a single-use token in the page URL never reaches the log', !logged.includes('SECRETTOKEN123'), logged);
  check('a secret in the blocked URL never reaches the log', !logged.includes('SECRETKEY'));
  check('query strings and fragments are dropped, path kept', legacy[0].page === 'https://app.example.com/verify' && legacy[0].blocked === 'https://evil.example/x.js', legacy[0]);

  const modern = normalizeCspReports([
    { type: 'csp-violation', body: { documentURL: 'https://app.example.com/reset-password?token=ABC', effectiveDirective: 'connect-src', blockedURL: 'https://x.example/api?q=1', disposition: 'enforce', lineNumber: 3 } },
    { type: 'deprecation', body: { id: 'x' } },
  ]);
  check('modern format parsed; non-CSP report types ignored', modern.length === 1 && modern[0].directive === 'connect-src', modern);
  check('modern format is token-safe too', !JSON.stringify(modern).includes('ABC') && modern[0].page === 'https://app.example.com/reset-password');

  check('keyword blocked-uris kept as-is', ['inline', 'eval', 'data', 'blob', 'self'].every((k) => cleanUrl(k) === k));
  check('data: URLs reduce to the scheme (they can be huge / carry content)', cleanUrl('data:image/png;base64,' + 'A'.repeat(50_000)) === 'data:');
  check('blob: URLs reduce to the scheme', cleanUrl('blob:https://app.example.com/1234-5678') === 'blob:');
  check('a relative path loses its query', cleanUrl('/api/x?token=abc#z') === '/api/x');
  check('fields are length-capped', cleanUrl('https://a.example/' + 'p'.repeat(5000)).length <= 201);
  const longDir = normalizeCspReports({ 'csp-report': { 'effective-directive': 'd'.repeat(5000) } });
  check('directive is length-capped', longDir[0].directive.length <= 201);
  check('at most MAX_REPORTS_PER_REQUEST modern reports are taken', normalizeCspReports(Array.from({ length: 50 }, () => ({ type: 'csp-violation', body: { effectiveDirective: 'x' } }))).length === MAX_REPORTS_PER_REQUEST);

  for (const junk of [null, undefined, 0, 'x', true, {}, [], [1, 2], { 'csp-report': 5 }, { 'csp-report': null }, [{ type: 'csp-violation' }], [{ type: 'csp-violation', body: 'x' }]]) {
    check(`junk payload ${JSON.stringify(junk)} -> []`, normalizeCspReports(junk).length === 0);
  }
  check('non-string fields do not throw or leak', normalizeCspReports({ 'csp-report': { 'blocked-uri': { a: 1 }, 'document-uri': 5, 'line-number': 'x' } })[0].line === null);

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
