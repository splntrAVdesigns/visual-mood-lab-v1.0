'use server';

// features/auth/actions.ts
//
// Server actions called directly from <form action={...}>. Auth.js's
// signIn() throws a special NEXT_REDIRECT error on success — that's
// intentional Next.js machinery for triggering navigation from a server
// action, so it must be re-thrown, never swallowed by the catch block.
//
// Every field here is re-validated against lib/validation/auth.ts even
// though the client (SignupForm / ResetPasswordForm) already checks the
// same schema — the client check is a UX nicety and is not trustworthy on
// its own; a request can always be sent directly to this action, bypassing
// the form entirely.

import { AuthError, CredentialsSignin } from 'next-auth';
import { eq } from 'drizzle-orm';
import { signIn, signOut } from '@/lib/auth/config';
import { getDb } from '@/lib/db/client';
import { users, accounts } from '@/lib/db/schema.auth';
import { hashPassword } from '@/lib/auth/hash';
import { isPasswordReused, recordPasswordHistory } from '@/lib/auth/password-history';
import {
  signupRateLimit,
  resetPasswordRateLimit,
  resendVerificationRateLimit,
} from '@/lib/auth/rate-limit';
import { signupEnabled, appleSignInEnabled } from '@/lib/auth/flags';
import { requireUser } from '@/lib/auth';
import { signupSchema, passwordSchema } from '@/lib/validation/auth';
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
  // Set on specific, client-actionable failures only (currently just
  // 'unverified_email') so a form can render a targeted follow-up action
  // (a "resend verification email" button) instead of just a red error
  // string. Anything not explicitly set here should be treated as opaque.
  code?: string;
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
    // Branch on `.code`, NOT `.message` substring matching. Auth.js v5
    // only preserves a distinguishable failure reason across the
    // authorize()-throw -> client boundary for CredentialsSignin
    // subclasses that set their own `code` (see lib/auth/errors.ts) — the
    // `.message` on ANY AuthError reaching this catch block is a generic,
    // library-owned string, never the text `authorize()` actually threw.
    // The previous version of this function checked
    // `error.message.includes('verify your email')`, which could never
    // match anything and silently turned every failure — wrong password,
    // unverified account, rate-limited — into the same "Invalid email or
    // password" response.
    if (error instanceof CredentialsSignin) {
      switch (error.code) {
        case 'unverified_email':
          return {
            error: 'Please verify your email before logging in.',
            code: 'unverified_email',
          };
        case 'rate_limited':
          return { error: 'Too many attempts. Try again shortly.' };
        default:
          // Bare CredentialsSignin (no user, or wrong password) —
          // deliberately generic, same as before: never confirm whether
          // the email exists or the password was specifically wrong.
          return { error: 'Invalid email or password.' };
      }
    }
    if (error instanceof AuthError) {
      return { error: 'Invalid email or password.' };
    }
    throw error;
  }
}

export async function loginWithGitHubAction(formData: FormData): Promise<void> {
  const callbackUrl = String(formData.get('callbackUrl') ?? '/');
  await signIn('github', { redirectTo: callbackUrl });
}

export async function loginWithAppleAction(formData: FormData): Promise<void> {
  // Defense in depth alongside the disabled button in LoginForm/SignupForm:
  // the button being unclickable doesn't stop a request posted directly to
  // this action, bypassing the UI entirely. Apple Sign-In isn't cleared by
  // Apple Developer review yet, so this must refuse even when reached
  // directly. Silent no-op (no redirect, no session) rather than a thrown
  // error — there's no error UI wired to this action to surface one to,
  // and the disabled button already tells a real user why nothing happens.
  if (!appleSignInEnabled) return;
  const callbackUrl = String(formData.get('callbackUrl') ?? '/');
  await signIn('apple', { redirectTo: callbackUrl });
}

export async function signupAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  if (!signupEnabled) {
    return { error: 'Signups are closed right now. Check back soon.' };
  }

  const raw = {
    username: String(formData.get('username') ?? ''),
    email: String(formData.get('email') ?? ''),
    password: String(formData.get('password') ?? ''),
  };

  // Authoritative validation — allowlisted username characters, email
  // format, and the full password policy (length, complexity, and the
  // "password" substring block) all live in one shared schema so this
  // can never drift from what SignupForm already checked client-side.
  const parsed = signupSchema.safeParse(raw);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Check the highlighted fields.' };
  }
  const { username, email, password } = parsed.data;

  const { success } = await signupRateLimit.limit(email);
  if (!success) {
    return { error: 'Too many attempts. Try again shortly.' };
  }

  const db = await getDb();

  const [existing] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (existing) {
    // Previously a dead end: this returned "account already exists" with
    // no way forward, even for someone who signed up, never got/clicked
    // the original verification email (spam filter, 24h token expiry,
    // mistyped inbox check), and is now trying again in good faith — the
    // ONLY thing standing between them and a working account was a fresh
    // link, which this branch used to refuse to send.
    //
    // Safe to be specific here (unlike requestPasswordResetAction below):
    // the person is already at the signup form typing this exact email,
    // so confirming an account exists for it leaks nothing they don't
    // already know from having just tried to create it.
    if (!existing.emailVerified) {
      const { success: withinLimit } = await resendVerificationRateLimit.limit(email);
      if (withinLimit) {
        const token = await createVerificationToken(email);
        try {
          await sendVerificationEmail(email, token);
        } catch (err) {
          console.error(
            '[signup] failed to resend verification email for existing unverified account:',
            err,
          );
        }
      }
      return {
        error:
          "An account with that email already exists but hasn't been verified yet. We just sent a new verification link — check your email.",
      };
    }
    return { error: 'An account with that email already exists.' };
  }

  const [existingUsername] = await db
    .select()
    .from(users)
    .where(eq(users.username, username))
    .limit(1);
  if (existingUsername) {
    return { error: 'That username is already taken.' };
  }

  const passwordHash = await hashPassword(password);

  let userId: string;
  try {
    // Bare .returning() (no column-selection argument) — getDb()'s return
    // type is a union of the Postgres and PGlite drivers (see
    // lib/db/client.ts's `Database` type), and TypeScript only accepts a
    // call signature common to every member of a union. PGlite's typed
    // `.returning()` overload doesn't accept a selection argument, so the
    // resolved signature across the union is zero-arg-only (confirmed via
    // `tsc --noEmit`: TS2554, "Expected 0 arguments, but got 1"). A bare
    // call returns the full inserted row on both drivers, so this just
    // reads `.id` off of it instead.
    const [inserted] = await db.insert(users).values({ email, username, passwordHash }).returning();
    userId = inserted.id;
  } catch (err) {
    // Belt-and-braces against a race between the uniqueness check above
    // and the insert (two signups for the same email/username landing
    // within the same request window) — the DB's own unique constraint
    // is the real guarantee; this just turns it into a friendly message
    // instead of a raw 500.
    console.error('[signup] insert failed:', err);
    return { error: 'That email or username is already in use.' };
  }

  // Seed password-history with the signup password itself, so a later
  // reset can't "reset" straight back to it — see lib/auth/password-history.ts.
  await recordPasswordHistory(userId, passwordHash);

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
  // Normalized the same way every other action here normalizes email —
  // previously this was the one action that didn't, reading the raw form
  // value with no .toLowerCase()/.trim(). Currently harmless in practice
  // (the value only ever came from the already-lowercased link
  // sendVerificationEmail built), but it had no defense of its own if a
  // link is ever hand-edited, forwarded through something that mangles
  // query-param casing, or retyped — worth closing for consistency alone.
  const email = String(formData.get('email') ?? '')
    .toLowerCase()
    .trim();
  const token = String(formData.get('token') ?? '');

  if (!email || !token) {
    return { error: 'Missing verification information.' };
  }

  const valid = await consumeVerificationToken(email, token);
  if (!valid) {
    return {
      error: 'This link is invalid or has expired. Request a new one below.',
    };
  }

  const db = await getDb();
  // .returning() (bare, no column-selection argument — same union-type
  // reason as signupAction's insert above) so a 0-row match (token was
  // valid, but no user row matches this exact email — deleted account, or
  // some future case where the two could drift) is a real, surfaced error
  // instead of a silent no-op UPDATE that still reports "success" to the
  // person.
  const updated = await db
    .update(users)
    .set({ emailVerified: new Date() })
    .where(eq(users.email, email))
    .returning();

  if (updated.length === 0) {
    return { error: 'No matching account was found for this link.' };
  }

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
  // cases (\"no account with that email\", \"too many requests\") would let
  // an attacker enumerate which emails have accounts on this site. The
  // only acceptable signal to leak is \"an email may or may not be on its
  // way\" — which is also, not coincidentally, the only thing a real user
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
  const rawPassword = String(formData.get('password') ?? '');

  if (!email || !token) {
    return { error: 'Missing reset information.' };
  }

  const parsedPassword = passwordSchema.safeParse(rawPassword);
  if (!parsedPassword.success) {
    return { error: parsedPassword.error.issues[0]?.message ?? 'Invalid password.' };
  }
  const password = parsedPassword.data;

  const valid = await consumePasswordResetToken(email, token);
  if (!valid) {
    return { error: 'This link is invalid or has expired. Request a new one.' };
  }

  const db = await getDb();

  // Read the account BEFORE writing anything. The previous version of
  // this action went straight to a blind `UPDATE ... WHERE email =
  // ${email}` with no read first — which meant a 0-row match (e.g. the
  // account was deleted between the reset email being sent and this
  // submit) would silently no-op and still return { success: true } to
  // the person. Reading first also gets us the user's id (needed for the
  // password-history check) and current passwordHash (checked as part of
  // that same reuse check) up front.
  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (!user) {
    return { error: 'This account no longer exists.' };
  }

  if (await isPasswordReused(user.id, password, user.passwordHash)) {
    return {
      error: "You've used this password recently. Choose one you haven't used on this account before.",
    };
  }

  const passwordHash = await hashPassword(password);

  // revokedAt kills every session/JWT issued before this exact moment —
  // any other device or browser tab that was already logged in, in case
  // the reset was triggered because the account was compromised. The jwt
  // callback in lib/auth/config.ts compares this against each token's own
  // issued-at time, so the fresh login this action's caller is about to
  // do (with the NEW password, after this write completes) is unaffected
  // — only tokens that predate the reset get rejected.
  //
  // emailVerified is stamped here too if it wasn't already set. This is
  // the fix for the actual reported bug: completing a password reset via
  // a token mailed to this exact address is just as strong a proof of
  // inbox ownership as clicking the /verify link is — there is no reason
  // an account that never finished signup verification should reset its
  // password successfully, receive the confirmation email, and then fail
  // every subsequent login against the SAME "please verify your email"
  // check that sent them to Forgot Password in the first place. Without
  // this line, that was a real, previously unrecoverable loop.
  await db
    .update(users)
    .set({
      passwordHash,
      revokedAt: new Date(),
      emailVerified: user.emailVerified ?? new Date(),
    })
    .where(eq(users.id, user.id));

  await recordPasswordHistory(user.id, passwordHash);

  return { success: true };
}

/**
 * Sends a fresh signup-verification link. Shared by three call sites:
 *  - VerifyForm, when the token in the URL has expired or was already used
 *    (the previous copy told people to "sign up again", which was a dead
 *    end — signupAction refuses to create a second account for an email
 *    that already has one)
 *  - LoginForm, offered inline once a login attempt surfaces the
 *    'unverified_email' code from loginAction
 *  - signupAction itself, automatically, when someone re-submits the
 *    signup form for an email that already has an unverified account
 *
 * Deliberately specific in its responses (unlike requestPasswordResetAction
 * above) rather than a uniform "an email may be on its way": every caller
 * of this action already knows the account exists — they arrived here
 * because a signup or login attempt just told them so — so there's no
 * enumeration risk being specific about why a resend didn't go out.
 */
export async function resendVerificationAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const email = String(formData.get('email') ?? '')
    .toLowerCase()
    .trim();

  if (!email) {
    return { error: 'Missing email.' };
  }

  const { success: withinLimit } = await resendVerificationRateLimit.limit(email);
  if (!withinLimit) {
    return { error: 'Too many attempts. Try again shortly.' };
  }

  const db = await getDb();
  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);

  if (!user) {
    return { error: 'No account found for that email.' };
  }
  if (user.emailVerified) {
    return { error: 'This account is already verified — you can log in.' };
  }

  const token = await createVerificationToken(email);
  try {
    await sendVerificationEmail(email, token);
  } catch (err) {
    console.error('[resend-verification] failed to send email:', err);
    return { error: 'Could not send the email right now. Try again shortly.' };
  }

  return { success: true };
}

export interface AccountInfo {
  name: string;
  email: string;
  username: string | null;
  createdAt: string;
  hasPassword: boolean;
  githubLinked: boolean;
  appleLinked: boolean;
}

/**
 * Read-only account summary for the account info popup (desktop header
 * name / mobile drawer footer). Deliberately a separate, on-demand server
 * action rather than data baked into requireUser()'s return value —
 * requireUser() runs on every single page render, and most of these
 * fields (createdAt, whether a password is set, linked-provider status)
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

  const linkedAccounts = await db
    .select({ provider: accounts.provider })
    .from(accounts)
    .where(eq(accounts.userId, user.id));

  const githubLinked = linkedAccounts.some((a) => a.provider === 'github');
  const appleLinked = linkedAccounts.some((a) => a.provider === 'apple');

  return {
    name: row.name ?? row.username ?? row.email,
    email: row.email,
    username: row.username,
    createdAt: row.createdAt.toISOString(),
    hasPassword: !!row.passwordHash,
    githubLinked,
    appleLinked,
  };
}

export async function logoutAction(): Promise<void> {
  await signOut({ redirectTo: '/login' });
}
