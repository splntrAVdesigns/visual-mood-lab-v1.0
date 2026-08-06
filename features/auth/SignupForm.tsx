'use client';

import { useActionState } from 'react';
import { TextInput, Button } from '@/components/ui';
import { signupAction, type FormState } from './actions';
import s from './auth.module.css';

const initialState: FormState = {};

export function SignupForm({ enabled }: { enabled: boolean }) {
  const [state, formAction, pending] = useActionState(signupAction, initialState);

  if (state.success) {
    return (
      <p className={s.notice}>
        Account created. Check your email to verify it, then log in.
      </p>
    );
  }

  return (
    <>
      {!enabled && (
        <p className={s.notice}>
          Signups are closed while the rest of the app is still being built.
        </p>
      )}

      <form action={formAction} className={s.form}>
        {state.error && (
          <p className={s.error} role="alert">
            {state.error}
          </p>
        )}

        <div>
          <label className={s.label} htmlFor="username">
            Username
          </label>
          <TextInput
            id="username"
            name="username"
            label="Username"
            autoComplete="username"
            required
            disabled={!enabled}
            onChange={() => {}}
          />
        </div>

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
            disabled={!enabled}
            onChange={() => {}}
          />
        </div>

        <div>
          <label className={s.label} htmlFor="password">
            Password
          </label>
          <TextInput
            id="password"
            name="password"
            type="password"
            label="Password"
            autoComplete="new-password"
            required
            disabled={!enabled}
            onChange={() => {}}
          />
        </div>

        <Button type="submit" variant="accent" block disabled={pending || !enabled}>
          {pending ? 'Creating account…' : 'Sign up'}
        </Button>
      </form>

      <p className={s.footer}>
        Already have an account? <a href="/login">Log in</a>
      </p>
    </>
  );
}
