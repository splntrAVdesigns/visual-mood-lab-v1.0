// proxy.ts
//
// Next.js 16 renamed the `middleware.ts` convention to `proxy.ts`. Per
// Next's own docs, proxy is invoked separately from render code and
// should NOT rely on shared modules or globals — in practice, that means
// it should not open its own database connection. Doing so against local
// PGlite (a single-writer, file-based embedded Postgres) collided with
// the main dev server's own connection to the same .pglite directory and
// crashed the WASM engine.
//
// So this is deliberately a CHEAP, DB-FREE check: does a session cookie
// exist at all? That's enough to redirect the common case (a fully
// logged-out visitor) fast, at the network boundary, with zero DB access.
//
// It is NOT the authoritative check — a stale or forged cookie would pass
// this. The real, DB-backed validation happens inside each protected
// page/layout via requireUser(), which runs in the normal render
// pipeline (same process as everything else, safe to share the cached
// PGlite/Postgres handle). Defense in depth, matching Next's own guidance
// to "enforce auth inside each Server Function rather than relying on
// the proxy alone."
//
// Deliberately does NOT bounce an apparently-logged-in visitor away from
// /login — a stale cookie (e.g. left over after a local database reset)
// combined with that rule created a redirect loop: requireUser() would
// correctly reject the stale session and send the visitor to /login,
// while this file's cookie-presence check would just as confidently
// bounce them back to /, forever. Skipping /login when already logged
// in was only ever a minor convenience; it isn't worth that fragility.

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Auth.js v5's default session-token cookie name. Prefixed with
// __Secure- automatically once the app is served over https (production).
const SESSION_COOKIE_NAMES = [
  "authjs.session-token",
  "__Secure-authjs.session-token",
];

function hasSessionCookie(req: NextRequest): boolean {
  return SESSION_COOKIE_NAMES.some((name) => req.cookies.has(name));
}

const PROTECTED_EXACT = new Set(["/"]);
const PROTECTED_PREFIXES = ["/board", "/asset", "/playground"];

export default function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const isProtected =
    PROTECTED_EXACT.has(pathname) ||
    PROTECTED_PREFIXES.some((p) => pathname.startsWith(p));

  // TEMPORARY DEBUG — remove once the redirect issue is confirmed fixed.
  console.log('[proxy]', pathname, 'protected=', isProtected, 'hasCookie=', hasSessionCookie(req));

  if (isProtected && !hasSessionCookie(req)) {
    const loginUrl = new URL("/login", req.nextUrl.origin);
    loginUrl.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|webp)$).*)",
  ],
};
