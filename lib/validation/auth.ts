// lib/validation/auth.ts
//
// Single source of truth for account-field validation. Imported by both
// the client forms (live validation / submit gating) and the server
// actions (authoritative check — the client check is a UX nicety, never
// trust it alone). One schema per field means the accepted character set
// and the error copy can't drift between the two call sites.
//
// npm i zod

import { z } from 'zod';

// Zod compiles a validator with `new Function` (its "JIT") and finds out
// whether that's allowed by ATTEMPTING it — `Function("")` in a try/catch.
// Under a Content-Security-Policy without 'unsafe-eval' the attempt is caught
// and zod falls back correctly, but the attempt itself is a CSP violation, so
// every login / signup page view would file a report (found by running the
// policy in Report-Only: one `script-src eval` per auth page load, from zod's
// own chunk). These schemas check a handful of short strings — the JIT buys
// nothing — so it's switched off, which also removes the probe.
z.config({ jitless: true });

/* ------------------------------------------------------------------ *
 * Username
 * ------------------------------------------------------------------ *
 * Allowlist, not blocklist: only characters explicitly decided to be
 * safe are accepted, rather than trying to enumerate every dangerous
 * one (unicode homoglyphs, zero-width characters, SQL/HTML-looking
 * strings, etc. are all excluded simply by not being in the set).
 */
export const USERNAME_REGEX = /^[a-zA-Z0-9_-]+$/;
export const USERNAME_MIN = 3;
export const USERNAME_MAX = 20;

export const usernameSchema = z
  .string()
  .trim()
  .min(USERNAME_MIN, `Username must be at least ${USERNAME_MIN} characters.`)
  .max(USERNAME_MAX, `Username must be ${USERNAME_MAX} characters or fewer.`)
  .regex(
    USERNAME_REGEX,
    'Username can only contain letters, numbers, hyphens, and underscores.',
  );

/* ------------------------------------------------------------------ *
 * Email
 * ------------------------------------------------------------------ */
export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1, 'Enter your email.')
  .max(254, 'Email is too long.')
  .email('Enter a valid email address.');

/* ------------------------------------------------------------------ *
 * Password
 * ------------------------------------------------------------------ *
 * 8–15 characters, at least one uppercase letter, one number, and one
 * special character. Also hard-blocks the literal word "password"
 * (case-insensitive, anywhere in the string) as its own named rule so
 * the UI can surface a distinct, unmissable message for it rather than
 * folding it into a generic complexity error.
 */
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 15;

const UPPERCASE_RE = /[A-Z]/;
const NUMBER_RE = /[0-9]/;
const SPECIAL_RE = /[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?~`]/;

export const containsForbiddenWord = (value: string): boolean =>
  value.toLowerCase().includes('password');

export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN, `Password must be ${PASSWORD_MIN}–${PASSWORD_MAX} characters.`)
  .max(PASSWORD_MAX, `Password must be ${PASSWORD_MIN}–${PASSWORD_MAX} characters.`)
  .refine((v) => UPPERCASE_RE.test(v), {
    message: 'Password must include at least one uppercase letter.',
  })
  .refine((v) => NUMBER_RE.test(v), {
    message: 'Password must include at least one number.',
  })
  .refine((v) => SPECIAL_RE.test(v), {
    message: 'Password must include at least one special character.',
  })
  .refine((v) => !containsForbiddenWord(v), {
    message: 'Password cannot contain the word "password".',
  });

/* ------------------------------------------------------------------ *
 * Composite schemas
 * ------------------------------------------------------------------ */
export const signupSchema = z.object({
  username: usernameSchema,
  email: emailSchema,
  password: passwordSchema,
});

export const resetPasswordSchema = z.object({
  password: passwordSchema,
});

export type SignupInput = z.infer<typeof signupSchema>;

export type FieldErrors<T> = Partial<Record<keyof T, string>>;

/**
 * Validates each signup field independently and returns one error message
 * per invalid field, rather than a single form-level message — this is
 * what lets the UI point at exactly the field that's wrong.
 */
export function validateSignupFields(input: {
  username: string;
  email: string;
  password: string;
}): FieldErrors<typeof input> {
  const errors: FieldErrors<typeof input> = {};

  const u = usernameSchema.safeParse(input.username);
  if (!u.success) errors.username = u.error.issues[0]?.message;

  const e = emailSchema.safeParse(input.email);
  if (!e.success) errors.email = e.error.issues[0]?.message;

  const p = passwordSchema.safeParse(input.password);
  if (!p.success) errors.password = p.error.issues[0]?.message;

  return errors;
}

export function validatePasswordField(password: string): string | undefined {
  const p = passwordSchema.safeParse(password);
  return p.success ? undefined : p.error.issues[0]?.message;
}

/* ------------------------------------------------------------------ *
 * Strong password generator
 * ------------------------------------------------------------------ *
 * Satisfies passwordSchema by construction — one character from each
 * required category, padded from a mixed pool, then shuffled with
 * crypto-backed randomness so the required characters aren't always in
 * the same position. Ambiguous characters (l/1/I, O/0) are excluded from
 * the pools so a generated password is easy to read back and retype.
 */
const LOWER = 'abcdefghjkmnpqrstuvwxyz';
const UPPER = 'ABCDEFGHJKMNPQRSTUVWXYZ';
const DIGITS = '23456789';
const SPECIAL = '!@#$%^&*-_+=?';

export function generateStrongPassword(length: number = 12): string {
  const len = Math.min(Math.max(length, PASSWORD_MIN), PASSWORD_MAX);
  const pool = LOWER + UPPER + DIGITS + SPECIAL;
  const pick = (set: string) => set[secureRandomInt(set.length)];

  const required = [pick(UPPER), pick(DIGITS), pick(SPECIAL), pick(LOWER)];
  const rest = Array.from({ length: Math.max(len - required.length, 0) }, () => pick(pool));
  const chars = [...required, ...rest];

  // Fisher–Yates shuffle using crypto-backed randomness, not Math.random().
  for (let i = chars.length - 1; i > 0; i--) {
    const j = secureRandomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }

  return chars.join('');
}

function secureRandomInt(maxExclusive: number): number {
  // crypto.getRandomValues is available both in the browser and in the
  // Node.js Web Crypto global exposed by the Next.js runtime, so this
  // file works unmodified whether it's imported from a client component
  // or a server action.
  const arr = new Uint32Array(1);
  crypto.getRandomValues(arr);
  return arr[0] % maxExclusive;
}
