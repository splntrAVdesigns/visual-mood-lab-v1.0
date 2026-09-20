// lib/security/headers.ts
//
// Security response headers, as pure functions so they can be tested without
// booting Next and reused by next.config.ts.
//
// WHY: a live `curl -i` of the production app showed HSTS (Vercel adds that)
// and nothing else — no CSP, no X-Content-Type-Options, no X-Frame-Options, no
// Referrer-Policy, no Permissions-Policy.
//
// Two policies, because the app has two very different documents:
//
//   1. The APP (everything except /sandbox). First-party code only; the only
//      external host it loads from is Vercel Blob (uploaded media, posters,
//      and the client-direct upload PUT). Fonts are self-hosted.
//
//   2. The SANDBOX (/sandbox/*). This document runs sketch code with
//      `new Function`, inside a null-origin iframe. It needs 'unsafe-eval' —
//      and nothing else it doesn't demonstrably use. In particular
//      `connect-src 'none'`: a sketch cannot phone home, exfiltrate, or be
//      used as a network probe. Today the sketches are yours; once Playground
//      lets people author them, this is what keeps their code contained.
//
// ROLLOUT: both start in Report-Only (see next.config.ts). A CSP that breaks a
// tile in production is worse than no CSP, and the only way to know what a
// policy would block is to watch it run. Reports go to /api/csp-report.

export interface Header {
  key: string;
  value: string;
}

export interface HeaderRule {
  source: string;
  headers: Header[];
}

export type CspMode = 'enforce' | 'report-only';

export const CSP_REPORT_PATH = '/api/csp-report';
export const CSP_REPORT_GROUP = 'csp-endpoint';

/** Vercel Blob: user uploads, captured posters/snapshots, and generated media. */
const BLOB_PUBLIC = 'https://*.public.blob.vercel-storage.com';
/** Vercel Blob client-upload endpoint (the browser PUTs bytes here directly). */
const BLOB_UPLOAD = 'https://blob.vercel-storage.com';

function directives(d: Record<string, string[]>): string {
  return Object.entries(d)
    .map(([name, values]) => (values.length > 0 ? `${name} ${values.join(' ')}` : name))
    .join('; ');
}

/**
 * The main app's policy.
 *
 * 'unsafe-inline' for script-src is a KNOWN, temporary concession: Next.js
 * emits inline bootstrap scripts, and nonce-based CSP means rendering every
 * page dynamically with a per-request nonce. It is the first thing to tighten
 * once Report-Only shows the rest of the policy is clean. style-src needs it
 * for React `style={{…}}` attributes.
 *
 * `dev` relaxes exactly what `next dev` needs (eval for React refresh, ws for
 * HMR) and nothing in production.
 */
export function buildAppCsp(opts: { dev: boolean }): string {
  const script = ["'self'", "'unsafe-inline'"];
  // data: and blob: are here because the app fetch()es them — found by running
  // this policy in Report-Only, not by guessing: p5.renderer.ts turns a
  // captured frame's data URL into a Blob with fetch(dataUrl) (poster capture
  // and Save snapshot on sketches), and blob: covers the same pattern for
  // object URLs. Neither touches the network; without them an enforced policy
  // would have silently broken snapshot capture.
  const connect = ["'self'", 'data:', 'blob:', BLOB_UPLOAD, BLOB_PUBLIC];
  if (opts.dev) {
    script.push("'unsafe-eval'");
    connect.push('ws:', 'wss:');
  }

  return directives({
    'default-src': ["'self'"],
    'script-src': script,
    'style-src': ["'self'", "'unsafe-inline'"],
    'img-src': ["'self'", 'data:', 'blob:', BLOB_PUBLIC],
    'media-src': ["'self'", 'blob:', BLOB_PUBLIC],
    'font-src': ["'self'", 'data:'],
    'connect-src': connect,
    'worker-src': ["'self'", 'blob:'],
    // The sketch sandbox is a same-origin URL framed by the app.
    'frame-src': ["'self'"],
    'object-src': ["'none'"],
    'base-uri': ["'self'"],
    // OAuth sign-in navigates the browser to these after a form submit.
    'form-action': ["'self'", 'https://github.com', 'https://appleid.apple.com'],
    'frame-ancestors': ["'none'"],
    'report-uri': [CSP_REPORT_PATH],
    'report-to': [CSP_REPORT_GROUP],
  });
}

/**
 * The sketch sandbox's policy. Deliberately much narrower than the app's:
 * this is the document that runs code the app itself did not write.
 *
 *  - script: the vendored p5 build ('self'), the runtime's own inline script,
 *    and 'unsafe-eval' because the runtime evaluates the sketch source.
 *  - connect-src data: ONLY: no fetch / XHR / WebSocket / beacon to any host.
 *    data: stays because the sandbox's own font loader decodes each font by
 *    fetch()ing a data URL (found by running this policy against real
 *    sketches in Report-Only) — that is a local decode, not a network request,
 *    and it cannot exfiltrate anything.
 *  - img/font/media: only data: and blob: URLs — the host hands the sandbox
 *    fonts and textures as data URLs / bitmaps (see p5.renderer.ts).
 */
export function buildSandboxCsp(): string {
  return directives({
    'default-src': ["'none'"],
    'script-src': ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
    'style-src': ["'unsafe-inline'"],
    'img-src': ['data:', 'blob:'],
    'font-src': ['data:'],
    'media-src': ['data:', 'blob:'],
    'connect-src': ['data:'],
    'worker-src': ['blob:'],
    'object-src': ["'none'"],
    'base-uri': ["'none'"],
    'form-action': ["'none'"],
    'frame-ancestors': ["'self'"],
    'report-uri': [CSP_REPORT_PATH],
    'report-to': [CSP_REPORT_GROUP],
  });
}

/**
 * Every capability the app does NOT use is switched off outright, so a
 * compromised dependency or injected script can't quietly turn on a camera or
 * read a location. What it does use is limited to same-origin.
 *
 * Used today (from a source audit): audio-only getUserMedia (mic input),
 * Web MIDI, the Gamepad API, Fullscreen, clipboard writes (code panel copy),
 * and Web Bluetooth is reserved for BLE-MIDI (Phase 4.97).
 */
export function buildPermissionsPolicy(): string {
  return [
    'camera=()',
    'microphone=(self)',
    'midi=(self)',
    'gamepad=(self)',
    'bluetooth=(self)',
    'fullscreen=(self)',
    'clipboard-write=(self)',
    'geolocation=()',
    'display-capture=()',
    'payment=()',
    'usb=()',
    'serial=()',
  ].join(', ');
}

const cspHeaderName = (mode: CspMode): string =>
  mode === 'enforce' ? 'Content-Security-Policy' : 'Content-Security-Policy-Report-Only';

/**
 * Header rules for next.config.ts `headers()`.
 *
 * Two non-overlapping rules on purpose. Next merges every matching rule, and
 * when two set the same key the last one wins — but Content-Security-Policy
 * and Content-Security-Policy-Report-Only are DIFFERENT keys, so a sandbox
 * rule enforcing its policy would otherwise also inherit the app's
 * report-only policy and flood /api/csp-report with false positives. The app
 * rule therefore excludes /sandbox explicitly.
 */
export function securityHeaderRules(opts: {
  dev: boolean;
  appCspMode: CspMode;
  sandboxCspMode: CspMode;
}): HeaderRule[] {
  const common: Header[] = [
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    { key: 'Permissions-Policy', value: buildPermissionsPolicy() },
    { key: 'Reporting-Endpoints', value: `${CSP_REPORT_GROUP}="${CSP_REPORT_PATH}"` },
  ];

  return [
    {
      source: '/((?!sandbox/).*)',
      headers: [
        ...common,
        { key: 'X-Frame-Options', value: 'DENY' },
        { key: cspHeaderName(opts.appCspMode), value: buildAppCsp({ dev: opts.dev }) },
      ],
    },
    {
      source: '/sandbox/:path*',
      headers: [
        ...common,
        // Framed by the app itself, so SAMEORIGIN rather than DENY.
        { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
        { key: cspHeaderName(opts.sandboxCspMode), value: buildSandboxCsp() },
      ],
    },
  ];
}
