'use client';

import { useActionState } from 'react';
import { Button } from '@/components/ui';
import { confirmEmailAction, resendVerificationAction, type FormState } from './actions';
import s from './auth.module.css';

const initialState: FormState = {};

// Deliberately a click, not an auto-verify on page load. Some corporate
// email clients pre-fetch every link in an email for scanning — an
// auto-verifying GET would let that scanner silently burn the one-time
// token before the person ever opens their inbox.
export function VerifyForm({ email, token }: { email: string; token: string }) {
  const [state, formAction, pending] = useActionState(confirmEmailAction, initialState);

  // Previously, a failed verify (expired/already-used token) told the
  // person to "sign up again" — a dead end, since signupAction refuses to
  // create a second account for an email that already has one. The actual
  // way out is a fresh verification link for the SAME account, which is
  // exactly what resendVerificationAction sends — reusing the `email` this
  // page already has from the original link's query param, so there's
  // nothing new to type.
  const [resendState, resendAction, resendPending] = useActionState(
    resendVerificationAction,
    initialState,
  );

  if (state.success) {
    return (
      <>
        <p className={s.notice}>Your email is verified.</p>
        <a href="/login" className={s.footer}>
          Continue to log in →
        </a>
      </>
    );
  }

  if (resendState.success) {
    return <p className={s.notice}>New verification link sent — check your email.</p>;
  }

  return (
    <>
      <form action={formAction} className={s.form}>
        {state.error && (
          <p className={s.error} role="alert">
            {state.error}
          </p>
        )}
        <input type="hidden" name="email" value={email} />
        <input type="hidden" name="token" value={token} />
        <Button type="submit" variant="accent" block disabled={pending}>
          {pending ? 'Verifying…' : 'Verify my email'}
        </Button>
      </form>

      {state.error && (
        <form action={resendAction} style={{ marginTop: 'var(--space-2)' }}>
          <input type="hidden" name="email" value={email} />
          {resendState.error && (
            <p className={s.error} role="alert">
              {resendState.error}
            </p>
          )}
          <Button type="submit" variant="outline" block disabled={resendPending}>
            {resendPending ? 'Sending…' : 'Send me a new link'}
          </Button>
        </form>
      )}
    </>
  );
}
