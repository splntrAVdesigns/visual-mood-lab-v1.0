'use client';

import { useActionState } from 'react';
import { Button } from '@/components/ui';
import { confirmEmailAction, type FormState } from './actions';
import s from './auth.module.css';

const initialState: FormState = {};

// Deliberately a click, not an auto-verify on page load. Some corporate
// email clients pre-fetch every link in an email for scanning — an
// auto-verifying GET would let that scanner silently burn the one-time
// token before the person ever opens their inbox.
export function VerifyForm({ email, token }: { email: string; token: string }) {
  const [state, formAction, pending] = useActionState(confirmEmailAction, initialState);

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

  return (
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
  );
}
