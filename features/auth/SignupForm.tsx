'use client';

import { useActionState, useMemo, useState } from 'react';
import { TextInput, Button } from '@/components/ui';
import { signupAction, loginWithGitHubAction, loginWithAppleAction, type FormState } from './actions';
import {
  usernameSchema,
  emailSchema,
  passwordSchema,
  containsForbiddenWord,
  generateStrongPassword,
  PASSWORD_MIN,
  PASSWORD_MAX,
} from '@/lib/validation/auth';
import s from './auth.module.css';

const initialState: FormState = {};

type Field = 'username' | 'email' | 'password';
type Touched = Record<Field, boolean>;

// Re-run per-field on every keystroke rather than debouncing: zod's
// safeParse on a single short string is sub-millisecond, so there's no
// perf reason to delay it, and instant feedback is what actually lets the
// person self-correct before submitting.
function fieldError(field: Field, value: string): string | undefined {
  switch (field) {
    case 'username':
      return usernameSchema.safeParse(value).success
        ? undefined
        : usernameSchema.safeParse(value).error?.issues[0]?.message;
    case 'email':
      return emailSchema.safeParse(value).success
        ? undefined
        : emailSchema.safeParse(value).error?.issues[0]?.message;
    case 'password':
      return passwordSchema.safeParse(value).success
        ? undefined
        : passwordSchema.safeParse(value).error?.issues[0]?.message;
  }
}

export function SignupForm({ enabled }: { enabled: boolean }) {
  const [state, formAction, pending] = useActionState(signupAction, initialState);

  const [values, setValues] = useState({ username: '', email: '', password: '' });
  const [touched, setTouched] = useState<Touched>({
    username: false,
    email: false,
    password: false,
  });

  const errors = useMemo(
    () => ({
      username: fieldError('username', values.username),
      email: fieldError('email', values.email),
      password: fieldError('password', values.password),
    }),
    [values],
  );

  // The "password" substring block is deliberately surfaced as its own
  // standalone notice, not folded into the general password error text —
  // this is the one rule that gets a full-width, hard-to-miss callout
  // rather than a small inline message under the field.
  const usesForbiddenWord = containsForbiddenWord(values.password);

  const allValid = !errors.username && !errors.email && !errors.password;
  const canSubmit = enabled && allValid && !pending;

  const markTouched = (field: Field) => setTouched((t) => ({ ...t, [field]: true }));

  const handleGeneratePassword = () => {
    const generated = generateStrongPassword(12);
    setValues((v) => ({ ...v, password: generated }));
    setTouched((t) => ({ ...t, password: true }));
  };

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

      <form action={formAction} className={s.form} noValidate>
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
            value={values.username}
            onChange={(value: string) => {
              setValues((v) => ({ ...v, username: value }));
            }}
            onBlur={() => markTouched('username')}
            aria-invalid={touched.username && !!errors.username}
            aria-describedby="username-error"
          />
          {touched.username && errors.username && (
            <p id="username-error" className={s.error} role="alert">
              {errors.username}
            </p>
          )}
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
            value={values.email}
            onChange={(value: string) => {
              setValues((v) => ({ ...v, email: value }));
            }}
            onBlur={() => markTouched('email')}
            aria-invalid={touched.email && !!errors.email}
            aria-describedby="email-error"
          />
          {touched.email && errors.email && (
            <p id="email-error" className={s.error} role="alert">
              {errors.email}
            </p>
          )}
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
            value={values.password}
            onChange={(value: string) => {
              setValues((v) => ({ ...v, password: value }));
            }}
            onBlur={() => markTouched('password')}
            aria-invalid={touched.password && !!errors.password}
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

          {touched.password && !usesForbiddenWord && errors.password && (
            <p id="password-error" className={s.error} role="alert">
              {errors.password}
            </p>
          )}

          <button
            type="button"
            className={s.forgotLink}
            onClick={handleGeneratePassword}
            disabled={!enabled}
          >
            Generate a strong password
          </button>
        </div>

        <Button type="submit" variant="accent" block disabled={!canSubmit}>
          {pending ? 'Creating account…' : 'Sign up'}
        </Button>
      </form>

      <div className={s.divider}>or</div>

      <form action={loginWithGitHubAction}>
        <Button type="submit" variant="outline" block disabled={!enabled}>
          Continue with GitHub
        </Button>
      </form>

      <form action={loginWithAppleAction} style={{ marginTop: 'var(--space-3)' }}>
        <Button type="submit" variant="outline" block disabled={!enabled}>
          Continue with Apple
        </Button>
      </form>

      <p className={s.footer}>
        Already have an account? <a href="/login">Log in</a>
      </p>
    </>
  );
}
