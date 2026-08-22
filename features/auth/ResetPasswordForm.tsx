'use client';

import { useActionState, useState } from 'react';
import { TextInput, Button } from '@/components/ui';
import { resetPasswordAction, type FormState } from './actions';
import {
  passwordSchema,
  containsForbiddenWord,
  generateStrongPassword,
  PASSWORD_MIN,
  PASSWORD_MAX,
} from '@/lib/validation/auth';
import s from './auth.module.css';

const initialState: FormState = {};

export function ResetPasswordForm({ email, token }: { email: string; token: string }) {
  const [state, formAction, pending] = useActionState(resetPasswordAction, initialState);

  const [password, setPassword] = useState('');
  const [touched, setTouched] = useState(false);

  const result = passwordSchema.safeParse(password);
  const error = result.success ? undefined : result.error.issues[0]?.message;
  const usesForbiddenWord = containsForbiddenWord(password);
  const canSubmit = result.success && !pending;

  const handleGeneratePassword = () => {
    setPassword(generateStrongPassword(12));
    setTouched(true);
  };

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
    <form action={formAction} className={s.form} noValidate>
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
          required
          value={password}
          onChange={(value: string) => setPassword(value)}
          onBlur={() => setTouched(true)}
          aria-invalid={touched && !!error}
          aria-describedby="password-hint password-error"
        />

        <p id="password-hint" className={s.notice} style={{ marginTop: 'var(--space-2)' }}>
          {PASSWORD_MIN}–{PASSWORD_MAX} characters, with at least one uppercase letter, one
          number, and one special character.
        </p>

        {usesForbiddenWord && (
          <p className={s.error} role="alert">
            Invalid password: your password cannot contain the word &ldquo;password&rdquo;.
          </p>
        )}

        {touched && !usesForbiddenWord && error && (
          <p id="password-error" className={s.error} role="alert">
            {error}
          </p>
        )}

        <button
          type="button"
          className={s.forgotLink}
          onClick={handleGeneratePassword}
        >
          Generate a strong password
        </button>
      </div>

      <Button type="submit" variant="accent" block disabled={!canSubmit}>
        {pending ? 'Updating…' : 'Update password'}
      </Button>
    </form>
  );
}
