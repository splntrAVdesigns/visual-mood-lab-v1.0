'use client';

import { useActionState } from 'react';
import { TextInput, Button } from '@/components/ui';
import { resetPasswordAction, type FormState } from './actions';
import s from './auth.module.css';

const initialState: FormState = {};

export function ResetPasswordForm({ email, token }: { email: string; token: string }) {
  const [state, formAction, pending] = useActionState(resetPasswordAction, initialState);

  if (state.success) {
    return (
      <>
        <p className={s.notice}>
          Password updated. Any other signed-in devices have been logged out.
        </p>
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

      <div>
        <label className={s.label} htmlFor="password">
          New password
        </label>
        <TextInput
          id="password"
          name="password"
          type="password"
          label="New password"
          autoComplete="new-password"
          minLength={8}
          required
          onChange={() => {}}
        />
      </div>

      <Button type="submit" variant="accent" block disabled={pending}>
        {pending ? 'Updating…' : 'Update password'}
      </Button>
    </form>
  );
}
