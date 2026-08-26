// lib/auth/flags.ts
export const signupEnabled = process.env.ALLOW_SIGNUP === "true";

/**
 * Apple Sign-In is gated off by default — the app hasn't cleared Apple
 * Developer review yet. Env-flag rather than a hardcoded `false` so
 * flipping it on once that clears is a config change, not a redeploy of
 * the gating logic itself in actions.ts / LoginForm.tsx / SignupForm.tsx.
 */
export const appleSignInEnabled = process.env.ALLOW_APPLE_SIGNIN === "true";
