// lib/http/api.ts
//
// Small helpers shared by the API routes.

import { NextResponse } from 'next/server';

/** Same ceiling for every JSON body — ~20x the largest legitimate tile state. */
export const MAX_JSON_BODY_BYTES = 256 * 1024;

export type JsonBody = { ok: true; body: unknown } | { ok: false; response: NextResponse };

/**
 * Reads a JSON request body with a hard size cap and a proper 400 for
 * malformed input. Previously routes called `req.json()` bare: bad JSON threw
 * into the catch-all (a 500 plus an error log for what is the caller's
 * mistake), and nothing bounded the size beyond the platform's own limit.
 */
export async function readJsonBody(req: Request, maxBytes: number = MAX_JSON_BODY_BYTES): Promise<JsonBody> {
  const declared = Number(req.headers.get('content-length') ?? NaN);
  if (Number.isFinite(declared) && declared > maxBytes) {
    return { ok: false, response: NextResponse.json({ error: 'Request body too large' }, { status: 413 }) };
  }

  let text: string;
  try {
    text = await req.text();
  } catch {
    return { ok: false, response: NextResponse.json({ error: 'Could not read request body' }, { status: 400 }) };
  }
  // Content-Length can be absent or wrong; this is the real enforcement.
  if (text.length > maxBytes) {
    return { ok: false, response: NextResponse.json({ error: 'Request body too large' }, { status: 413 }) };
  }

  try {
    return { ok: true, body: JSON.parse(text) as unknown };
  } catch {
    return { ok: false, response: NextResponse.json({ error: 'Body must be valid JSON' }, { status: 400 }) };
  }
}

export function badRequest(message: string): NextResponse {
  return NextResponse.json({ error: message }, { status: 400 });
}

/**
 * Maps requireUser()'s UnauthorizedError to a 401. Every route's catch-all
 * turned it into a 500 "Failed to …" plus an error log line — noise in the
 * logs for what is an ordinary "not signed in", and the wrong status for any
 * client that wants to react to an expired session. Matches by `status`
 * rather than instanceof, the same way GET /api/assets always has, so it
 * keeps working across the dynamic-import boundary requireUser() sits behind.
 */
export function unauthorizedResponse(err: unknown): NextResponse | null {
  if (err instanceof Error && (err as { status?: number }).status === 401) {
    return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  }
  return null;
}

export function isPlainRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}
