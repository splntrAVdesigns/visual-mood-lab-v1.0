// lib/auth/safe-redirect.ts
//
// `callbackUrl` is attacker-controllable — proxy.ts only ever sets it to
// the request's own pathname when redirecting an unauthenticated visitor,
// but nothing stops someone from sharing a crafted
// /login?callbackUrl=https://evil.example/phish link directly, bypassing
// proxy.ts entirely. Auth.js's own redirect() callback already restricts
// the GitHub OAuth path to same-origin by default (no custom override in
// lib/auth/config.ts), but the credentials path is a plain client-side
// router.push() in LoginForm.tsx with no such protection built in.
//
// Sanitizing once here, at the point callbackUrl is first read from the
// URL, covers both paths — they both consume the same validated value.

export function safeCallbackUrl(raw: string | undefined | null): string {
  if (!raw) return '/';

  // Must be a same-origin relative path: single leading slash, not '//host'
  // (protocol-relative — browsers treat this as an absolute URL to a
  // different host) and no embedded scheme. Anything else collapses to
  // '/' rather than being partially sanitized — a full reset is much
  // harder to get subtly wrong than trying to strip just the dangerous
  // part of an untrusted string.
  if (!raw.startsWith('/') || raw.startsWith('//')) return '/';

  return raw;
}
