'use client';

import { useActionState } from 'react';
import { TextInput, Button } from '@/components/ui';
import { requestPasswordResetAction, type FormState } from './actions';
import s from './auth.module.css';

const initialState: FormState = {};

export function ForgotPasswordForm() {
  const [state, formAction, pending] = useActionState(requestPasswordResetAction, initialState);

  if (state.success) {
    return (
      <>
        <p className={s.notice}>
          If there&rsquo;s an account for that email, a reset link is on its way. It expires in 1
          hour.
        </p>
        <a href="/login" className={s.footer}>
          Back to log in →
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

      <div>
        <label className={s.label} htmlFor="email">
          Email
        </label>
        <TextInput
          id="email"
          name="email"
          type="email"
          label="Email"
          autoComplete="email"
          required
          onChange={() => {}}
        />
      </div>

      <Button type="submit" variant="accent" block disabled={pending}>
        {pending ? 'Sending…' : 'Send reset link'}
      </Button>

      <p className={s.footer}>
        <a href="/login">Back to log in</a>
      </p>
    </form>
  );
}
