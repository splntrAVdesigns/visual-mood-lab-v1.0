import { NextResponse } from 'next/server';
import { checkLimits, cspReportRateLimit } from '@/lib/auth/rate-limit';
import { clientIpKey } from '@/lib/http/client-ip';
import { readJsonBody } from '@/lib/http/api';
import { normalizeCspReports } from '@/lib/security/csp-report';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/csp-report — where browsers send Content-Security-Policy
 * violation reports (see lib/security/headers.ts).
 *
 * Unauthenticated by necessity: the browser sends these on its own, and a
 * violation on the login page happens before any session exists. So it is
 * hardened as a public endpoint — a 16 KB body cap, a per-IP rate limit, no
 * echo of the input, and reports are reduced to a log-safe shape first
 * (lib/security/csp-report.ts strips query strings, because this app's page
 * URLs carry single-use verify/reset tokens). Always answers 204: a browser
 * ignores the response, and there is nothing useful to tell it.
 */
export async function POST(req: Request) {
  const allowed = await checkLimits([[cspReportRateLimit, clientIpKey(req.headers)]]);
  if (!allowed) return new NextResponse(null, { status: 429 });

  const parsed = await readJsonBody(req, 16 * 1024);
  if (!parsed.ok) return parsed.response;

  for (const violation of normalizeCspReports(parsed.body)) {
    console.warn('[csp-report]', JSON.stringify(violation));
  }
  return new NextResponse(null, { status: 204 });
}
