// lib/site.ts
//
// The app's public origin — the one place that answers "what URL is this site
// served from?". Next needs it as `metadataBase` to turn the generated Open
// Graph image (app/opengraph-image.tsx) into an absolute URL for link previews.
// Without it Next guesses http://localhost:3000 and says so at build time, and
// in production every shared link would point its preview image at localhost.
//
// ORDER, first usable wins:
//   1. APP_URL                        — explicit. Already used by the verification
//                                       and password-reset emails (lib/auth/
//                                       verification.ts), so it is the same
//                                       variable, not a second one to keep in sync.
//   2. VERCEL_URL                     — only on Vercel PREVIEW deployments, so a
//                                       preview's links stay on that preview.
//   3. VERCEL_PROJECT_PRODUCTION_URL  — Vercel's production domain (custom domain
//                                       if you have one). Set automatically.
//   4. VERCEL_URL                     — any other Vercel deployment.
//   5. http://localhost:3000          — local development.
// So on Vercel this needs NO configuration; set APP_URL only to override.
//
// Only the ORIGIN is kept (scheme + host + port). A path or trailing slash in
// APP_URL is dropped — the app is served from the root. A bare host
// ("mood.example.com", which is how Vercel reports its own URLs) gets https://;
// a bare localhost gets http://. Anything unusable falls through to the next
// rule instead of throwing, because this runs while every page's metadata is
// built and must never take the site down over a typo in an env var.

type Env = Record<string, string | undefined>;

const LOCAL_ORIGIN = 'http://localhost:3000';

/** "mood.example.com", "https://mood.example.com/x/" or "localhost:3000" → an http(s) origin, or null. */
export function toOrigin(raw: string | undefined): string | null {
  const value = raw?.trim();
  if (!value) return null;

  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(value);
  const isLocalHost = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/i.test(value);
  // A protocol-relative "//host" is read as a host; the leading slashes are dropped explicitly.
  const candidate = hasScheme ? value : `${isLocalHost ? 'http' : 'https'}://${value.replace(/^\/+/, '')}`;

  try {
    const url = new URL(candidate);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (!url.hostname) return null;
    return url.origin;
  } catch {
    return null;
  }
}

let warnedAboutAppUrl = false;

export function siteUrl(env: Env = process.env): URL {
  const explicit = toOrigin(env.APP_URL);
  if (explicit) return new URL(explicit);

  if (env.APP_URL?.trim() && !warnedAboutAppUrl) {
    warnedAboutAppUrl = true;
    console.warn(`[site] APP_URL is set to "${env.APP_URL}" but is not a usable http(s) URL — ignoring it.`);
  }

  const onVercel = env.VERCEL_ENV === 'preview'
    ? [env.VERCEL_URL, env.VERCEL_PROJECT_PRODUCTION_URL]
    : [env.VERCEL_PROJECT_PRODUCTION_URL, env.VERCEL_URL];
  for (const candidate of onVercel) {
    const origin = toOrigin(candidate);
    if (origin) return new URL(origin);
  }
  return new URL(LOCAL_ORIGIN);
}
