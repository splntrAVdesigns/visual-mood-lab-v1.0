'use server';

// features/auth/actions.ts
//
// Server actions called directly from <form action={...}>. Auth.js's
// signIn() throws a special NEXT_REDIRECT error on success — that's
// intentional Next.js machinery for triggering navigation from a server
// action, so it must be re-thrown, never swallowed by the catch block.

import { AuthError } from 'next-auth';
import { eq, and } from 'drizzle-orm';
import { signIn, signOut } from '@/lib/auth/config';
import { getDb } from '@/lib/db/client';
import { users, accounts } from '@/lib/db/schema.auth';
import { hashPassword } from '@/lib/auth/hash';
import { signupRateLimit, resetPasswordRateLimit } from '@/lib/auth/rate-limit';
import { signupEnabled } from '@/lib/auth/flags';
import { requireUser } from '@/lib/auth';
import {
  createVerificationToken,
  sendVerificationEmail,
  consumeVerificationToken,
  createPasswordResetToken,
  sendPasswordResetEmail,
  consumePasswordResetToken,
} from '@/lib/auth/verification';

export interface FormState {
  error?: string;
  success?: boolean;
}

export async function loginAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const email = String(formData.get('email') ?? '').trim();
  const password = String(formData.get('password') ?? '');

  if (!email || !password) {
    return { error: 'Enter your email and password.' };
  }

  try {
    // redirect: false — Auth.js's default behavior throws a redirect()
    // internally on success, which was double-firing this action in dev
    // (confirmed via DevTools: the second /login request's initiator was
    // this file itself, not a second form submission). Returning a plain
    // result instead and letting the client component navigate explicitly
    // avoids that mechanism entirely.
    await signIn('credentials', {
      email,
      password,
      redirect: false,
    });
    return { success: true };
  } catch (error) {
    if (error instanceof AuthError) {
      // Deliberately generic — never confirm whether the email exists,
      // whether the password was wrong, or account state, beyond the
      // one case (unverified email) worth telling the person about.
      if (error.message.includes('verify your email')) {
        return { error: 'Please verify your email before logging in.' };
      }
      if (error.message.includes('Too many attempts')) {
        return { error: 'Too many attempts. Try again shortly.' };
      }
      return { error: 'Invalid email or password.' };
    }
    throw error;
  }
}

export async function loginWithGitHubAction(formData: FormData): Promise<void> {
  const callbackUrl = String(formData.get('callbackUrl') ?? '/');
  await signIn('github', { redirectTo: callbackUrl });
}

export async function signupAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  if (!signupEnabled) {
    return { error: 'Signups are closed right now. Check back soon.' };
  }

  const email = String(formData.get('email') ?? '').toLowerCase().trim();
  const username = String(formData.get('username') ?? '').trim();
  const password = String(formData.get('password') ?? '');

  if (!email || !username || !password) {
    return { error: 'All fields are required.' };
  }
  if (password.length < 8) {
    return { error: 'Password must be at least 8 characters.' };
  }

  const { success } = await signupRateLimit.limit(email);
  if (!success) {
    return { error: 'Too many attempts. Try again shortly.' };
  }

  const db = await getDb();

  const [existing] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (existing) {
    return { error: 'An account with that email already exists.' };
  }

  const passwordHash = await hashPassword(password);
  await db.insert(users).values({ email, username, passwordHash });

  const token = await createVerificationToken(email);
  try {
    await sendVerificationEmail(email, token);
  } catch (err) {
    // The account row already exists at this point — don't leave the
    // person with no way forward. Log the real cause server-side, tell
    // them plainly what happened.
    console.error('[signup] failed to send verification email:', err);
    return {
      error: 'Account created, but the verification email failed to send. Contact support.',
    };
  }

  return { success: true };
}

export async function confirmEmailAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const email = String(formData.get('email') ?? '');
  const token = String(formData.get('token') ?? '');

  if (!email || !token) {
    return { error: 'Missing verification information.' };
  }

  const valid = await consumeVerificationToken(email, token);
  if (!valid) {
    return { error: 'This link is invalid or has expired. Sign up again to get a new one.' };
  }

  const db = await getDb();
  await db.update(users).set({ emailVerified: new Date() }).where(eq(users.email, email));

  return { success: true };
}

export async function requestPasswordResetAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const email = String(formData.get('email') ?? '')
    .toLowerCase()
    .trim();

  if (!email) {
    return { error: 'Enter your email.' };
  }

  const { success: withinLimit } = await resetPasswordRateLimit.limit(email);

  // The response is identical whether the account exists, was rate
  // limited, or the email send failed — every branch below falls through
  // to the same `{ success: true }`. Telling the truth in any of those
  // cases ("no account with that email", "too many requests") would let
  // an attacker enumerate which emails have accounts on this site. The
  // only acceptable signal to leak is "an email may or may not be on its
  // way" — which is also, not coincidentally, the only thing a real user
  // needs to know to proceed.
  if (withinLimit) {
    const db = await getDb();
    const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);

    if (user) {
      const token = await createPasswordResetToken(email);
      try {
        await sendPasswordResetEmail(email, token);
      } catch (err) {
        // Real cause goes to the server log; the person still sees the
        // generic success message and can simply try again if the email
        // never arrives, rather than being told about a delivery failure
        // that also happens to confirm their account exists.
        console.error('[reset-password] failed to send email:', err);
      }
    }
  }

  return { success: true };
}

export async function resetPasswordAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const email = String(formData.get('email') ?? '')
    .toLowerCase()
    .trim();
  const token = String(formData.get('token') ?? '');
  const password = String(formData.get('password') ?? '');

  if (!email || !token) {
    return { error: 'Missing reset information.' };
  }
  if (password.length < 8) {
    return { error: 'Password must be at least 8 characters.' };
  }

  const valid = await consumePasswordResetToken(email, token);
  if (!valid) {
    return { error: 'This link is invalid or has expired. Request a new one.' };
  }

  const db = await getDb();
  const passwordHash = await hashPassword(password);

  // revokedAt kills every session/JWT issued before this exact moment —
  // any other device or browser tab that was already logged in, in case
  // the reset was triggered because the account was compromised. The jwt
  // callback in lib/auth/config.ts compares this against each token's own
  // issued-at time, so the fresh login this action's caller is about to
  // do (with the NEW password, after this write completes) is unaffected
  // — only tokens that predate the reset get rejected.
  await db
    .update(users)
    .set({ passwordHash, revokedAt: new Date() })
    .where(eq(users.email, email));

  return { success: true };
}

export interface AccountInfo {
  name: string;
  email: string;
  username: string | null;
  createdAt: string;
  hasPassword: boolean;
  githubLinked: boolean;
}

/**
 * Read-only account summary for the account info popup (desktop header
 * name / mobile drawer footer). Deliberately a separate, on-demand server
 * action rather than data baked into requireUser()'s return value —
 * requireUser() runs on every single page render, and most of these
 * fields (createdAt, whether a password is set, GitHub link status)
 * are only ever needed the moment someone actually opens this popup.
 */
export async function getAccountInfoAction(): Promise<AccountInfo | null> {
  let user;
  try {
    user = await requireUser();
  } catch {
    return null;
  }

  const db = await getDb();
  const [row] = await db.select().from(users).where(eq(users.id, user.id)).limit(1);
  if (!row) return null;

  const [githubAccount] = await db
    .select({ provider: accounts.provider })
    .from(accounts)
    .where(and(eq(accounts.userId, user.id), eq(accounts.provider, 'github')))
    .limit(1);

  return {
    name: row.name ?? row.username ?? row.email,
    email: row.email,
    username: row.username,
    createdAt: row.createdAt.toISOString(),
    hasPassword: !!row.passwordHash,
    githubLinked: !!githubAccount,
  };
}

export async function logoutAction(): Promise<void> {
  await signOut({ redirectTo: '/login' });
}
