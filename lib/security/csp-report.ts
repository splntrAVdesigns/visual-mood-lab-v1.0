// lib/security/csp-report.ts
//
// Turns the two browser CSP report formats into one small, log-safe shape.
//
//   legacy  (report-uri):  { "csp-report": { "document-uri": …, … } }
//                          Content-Type: application/csp-report
//   modern  (report-to):   [ { "type": "csp-violation", "body": { "documentURL": … } } ]
//                          Content-Type: application/reports+json
//
// LOG SAFETY is the point of this module. A violation report carries the page
// URL, and this app's page URLs carry secrets: /verify?token=… and
// /reset-password?token=… hold single-use credentials. Logging a report
// verbatim would write live tokens into the platform logs. Every URL is
// therefore reduced to origin + path — query strings and fragments are
// dropped — and every string is length-capped. The endpoint is
// unauthenticated by necessity (browsers send reports without a session), so
// everything in a report is attacker-controllable and treated as untrusted.

export interface CspViolation {
  directive: string;
  blocked: string;
  page: string;
  source: string;
  line: number | null;
  disposition: string;
}

const MAX_FIELD = 200;
export const MAX_REPORTS_PER_REQUEST = 5;

/** blocked-uri can be a keyword rather than a URL. */
const KEYWORDS = new Set(['inline', 'eval', 'wasm-eval', 'data', 'blob', 'self', 'trusted-types-policy', 'trusted-types-sink']);

function cap(s: string): string {
  return s.length > MAX_FIELD ? `${s.slice(0, MAX_FIELD)}…` : s;
}

/** Origin + path only; never a query string or fragment. */
export function cleanUrl(value: unknown): string {
  if (typeof value !== 'string' || value === '') return '';
  const v = value.trim();
  if (KEYWORDS.has(v)) return v;

  // data: / blob: URLs can be enormous and can embed content — keep the scheme only.
  if (/^data:/i.test(v)) return 'data:';
  if (/^blob:/i.test(v)) return 'blob:';

  try {
    const u = new URL(v);
    return cap(`${u.origin === 'null' ? u.protocol : u.origin}${u.pathname}`);
  } catch {
    // Not an absolute URL (e.g. a relative path from a legacy report).
    return cap(v.split(/[?#]/)[0]);
  }
}

function str(v: unknown): string {
  return typeof v === 'string' ? cap(v) : '';
}

function fromLegacy(body: Record<string, unknown>): CspViolation {
  return {
    directive: str(body['effective-directive'] ?? body['violated-directive']),
    blocked: cleanUrl(body['blocked-uri']),
    page: cleanUrl(body['document-uri']),
    source: cleanUrl(body['source-file']),
    line: typeof body['line-number'] === 'number' ? body['line-number'] : null,
    disposition: str(body['disposition']),
  };
}

function fromModern(body: Record<string, unknown>): CspViolation {
  return {
    directive: str(body.effectiveDirective ?? body.violatedDirective),
    blocked: cleanUrl(body.blockedURL),
    page: cleanUrl(body.documentURL),
    source: cleanUrl(body.sourceFile),
    line: typeof body.lineNumber === 'number' ? body.lineNumber : null,
    disposition: str(body.disposition),
  };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** Never throws; anything unrecognised yields []. */
export function normalizeCspReports(payload: unknown): CspViolation[] {
  try {
    const out: CspViolation[] = [];

    if (Array.isArray(payload)) {
      for (const item of payload.slice(0, MAX_REPORTS_PER_REQUEST)) {
        if (isRecord(item) && item.type === 'csp-violation' && isRecord(item.body)) out.push(fromModern(item.body));
      }
      return out;
    }

    if (isRecord(payload) && isRecord(payload['csp-report'])) {
      out.push(fromLegacy(payload['csp-report']));
    }
    return out;
  } catch {
    return [];
  }
}
