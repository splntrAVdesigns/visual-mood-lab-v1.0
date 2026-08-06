'use client';

import { useEffect, useActionState } from 'react';
import { useRouter } from 'next/navigation';
import type { Route } from 'next';
import { TextInput, Button } from '@/components/ui';
import { loginAction, loginWithGitHubAction, type FormState } from './actions';
import s from './auth.module.css';

const initialState: FormState = {};

export function LoginForm({ callbackUrl }: { callbackUrl: string }) {
  const [state, formAction, pending] = useActionState(loginAction, initialState);
  const router = useRouter();

  // Explicit client-side navigation on success, rather than throwing
  // redirect() inside the server action itself — that pattern was
  // double-invoking the action in dev (confirmed via DevTools Initiator:
  // the second /login request traced back to actions.ts, not a second
  // form submission).
  //
  // The `as Route` cast is safe specifically because callbackUrl arrives
  // pre-validated by lib/auth/safe-redirect.ts's safeCallbackUrl() in the
  // /login page — typedRoutes can't statically know a runtime string
  // matches a real route, but this value is guaranteed to be a same-origin
  // relative path by the time it reaches this component, not an arbitrary
  // unchecked string.
  useEffect(() => {
    if (state.success) {
      router.push(callbackUrl as Route);
    }
  }, [state.success, callbackUrl, router]);

  return (
    <>
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

        <div>
          <label className={s.label} htmlFor="password">
            Password
          </label>
          <TextInput
            id="password"
            name="password"
            type="password"
            label="Password"
            autoComplete="current-password"
            required
            onChange={() => {}}
          />
          <a href="/forgot-password" className={s.forgotLink}>
            Forgot password?
          </a>
        </div>

        <Button type="submit" variant="accent" block disabled={pending || state.success}>
          {pending ? 'Logging in…' : state.success ? 'Redirecting…' : 'Log in'}
        </Button>
      </form>

      <div className={s.divider}>or</div>

      <form action={loginWithGitHubAction}>
        <input type="hidden" name="callbackUrl" value={callbackUrl} />
        <Button type="submit" variant="outline" block>
          Continue with GitHub
        </Button>
      </form>

      <p className={s.footer}>
        Don&rsquo;t have an account? <a href="/signup">Sign up</a>
      </p>
    </>
  );
}
