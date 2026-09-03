// lib/auth/verification.ts
//
// Uses the verificationTokens table Auth.js's adapter contract already
// gives us (schema.auth.ts) — no new table needed. A token is single-use:
// consuming it always deletes the row on read, even if expired, so a link
// can never be replayed.
//
// Two purposes share this table — signup email verification and password
// reset — but they must never be able to satisfy each other. A signup
// link and a reset link differ only by which route the person is on; if
// both looked tokens up under the bare email as the identifier, a signup
// verification email accidentally forwarded or intercepted could be used
// to reset that account's password instead, since consumeToken() has no
// way to know which the caller meant. Namespacing the identifier
// (`reset:<email>` vs bare `<email>`) makes the two token spaces disjoint
// by construction — no purpose field to forget to check, no shared code
// path that has to remember to compare it.

import { randomBytes } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { getDb } from '@/lib/db/client';
import { verificationTokens } from '@/lib/db/schema.auth';

const TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour — shorter: a live inbox
// compromise is the realistic threat model for a reset link, and an hour is
// plenty of time for a real person to click through their own email.

async function createToken(identifier: string, ttlMs: number): Promise<string> {
  const db = await getDb();
  const token = randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + ttlMs);

  // Only the newest link should ever work — clear anything issued earlier
  // for this identifier so an old, possibly-forwarded email can't be used
  // once a newer one has been requested.
  await db.delete(verificationTokens).where(eq(verificationTokens.identifier, identifier));
  await db.insert(verificationTokens).values({ identifier, token, expires });

  return token;
}

async function consumeToken(identifier: string, token: string): Promise<boolean> {
  const db = await getDb();

  const [row] = await db
    .select()
    .from(verificationTokens)
    .where(and(eq(verificationTokens.identifier, identifier), eq(verificationTokens.token, token)))
    .limit(1);

  if (!row) return false;

  await db
    .delete(verificationTokens)
    .where(and(eq(verificationTokens.identifier, identifier), eq(verificationTokens.token, token)));

  return row.expires >= new Date();
}

/* ------------------------------------------------------------------ *
 * Signup email verification
 * ------------------------------------------------------------------ */

export async function createVerificationToken(email: string): Promise<string> {
  return createToken(email, TOKEN_TTL_MS);
}

export async function consumeVerificationToken(email: string, token: string): Promise<boolean> {
  return consumeToken(email, token);
}

export async function sendVerificationEmail(email: string, token: string): Promise<void> {
  const baseUrl = process.env.APP_URL ?? 'http://localhost:3000';
  const link = `${baseUrl}/verify?token=${token}&email=${encodeURIComponent(email)}`;
  await sendAuthEmail({
    to: email,
    subject: 'Verify your email — Visual Mood Lab',
    html: `<p>Click below to verify your email and finish creating your account.</p><p><a href="${link}">${link}</a></p><p>This link expires in 24 hours.</p>`,
    devLogLabel: 'verify',
    devLink: link,
  });
}

/* ------------------------------------------------------------------ *
 * Password reset
 * ------------------------------------------------------------------ */

function resetIdentifier(email: string): string {
  return `reset:${email}`;
}

export async function createPasswordResetToken(email: string): Promise<string> {
  return createToken(resetIdentifier(email), RESET_TOKEN_TTL_MS);
}

export async function consumePasswordResetToken(email: string, token: string): Promise<boolean> {
  return consumeToken(resetIdentifier(email), token);
}

export async function sendPasswordResetEmail(email: string, token: string): Promise<void> {
  const baseUrl = process.env.APP_URL ?? 'http://localhost:3000';
  const link = `${baseUrl}/reset-password?token=${token}&email=${encodeURIComponent(email)}`;
  await sendAuthEmail({
    to: email,
    subject: 'Reset your password — Visual Mood Lab',
    html: `<p>Click below to choose a new password.</p><p><a href="${link}">${link}</a></p><p>This link expires in 1 hour. If you didn't request this, you can safely ignore this email — your password hasn't been changed.</p>`,
    devLogLabel: 'reset',
    devLink: link,
  });
}

/**
 * Sent once a reset actually completes — distinct from sendPasswordResetEmail
 * above, which is the earlier "click here to choose a new password" link.
 * This didn't previously exist: the only reset-related email in this file
 * was the link itself, so a person had no separate confirmation that their
 * password had actually finished changing. Best-effort and non-blocking by
 * design — see the call site in resetPasswordAction (features/auth/actions.ts)
 * for why a failure here must never affect whether the reset itself is
 * reported as successful.
 */
export async function sendPasswordChangedEmail(email: string): Promise<void> {
  const baseUrl = process.env.APP_URL ?? 'http://localhost:3000';
  await sendAuthEmail({
    to: email,
    subject: 'Your password was changed — Visual Mood Lab',
    html: `<p>This confirms your Visual Mood Lab password was just changed. You've been logged out on any other devices as a precaution.</p><p>If you didn't make this change, reset your password again immediately: <a href="${baseUrl}/forgot-password">${baseUrl}/forgot-password</a></p>`,
    devLogLabel: 'password-changed',
    devLink: `${baseUrl}/login`,
  });
}

/* ------------------------------------------------------------------ *
 * Shared send path
 * ------------------------------------------------------------------ */

async function sendAuthEmail(opts: {
  to: string;
  subject: string;
  html: string;
  devLogLabel: string;
  devLink: string;
}): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    // No Resend key configured — print the link instead of failing
    // outright. Loud in the dev console, but never silently blocks local
    // testing when email isn't wired up yet.
    console.warn(
      `[${opts.devLogLabel}] RESEND_API_KEY not set — link for ${opts.to}:\n  ${opts.devLink}`,
    );
    return;
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      // Verified domain (splntr-microtools.com, via Vercel's Resend
      // integration) — no longer restricted to Resend's test-sender
      // free-tier rule that only delivered to the account owner's own
      // email.
      from: 'Visual Mood Lab <noreply@splntr-microtools.com>',
      to: [opts.to],
      subject: opts.subject,
      html: opts.html,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Resend API error (${res.status}): ${body}`);
  }
}
