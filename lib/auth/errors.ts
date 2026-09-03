// lib/auth/errors.ts
//
// Auth.js v5 does NOT propagate a plain `throw new Error("...")` from
// inside Credentials `authorize()` to the client. As of
// nextauthjs/next-auth#10200 (merged Mar 2024), a custom failure reason
// only survives the round trip if the thrown error is a subclass of
// `CredentialsSignin` with its own `code`. Anything else — including the
// two plain `Error`s this project used to throw for "please verify your
// email" and "too many attempts" — gets caught internally and collapsed
// into a generic CredentialsSignin with a generic message. The caller
// (features/auth/actions.ts's loginAction) can only ever see that generic
// shape, which is why every failure reason, regardless of actual cause,
// used to surface identically as "Invalid email or password."
//
// Fix: one subclass per distinguishable failure reason we want the client
// to react to differently. Plain wrong-password / no-such-user stays a
// bare `CredentialsSignin` (default `code: "credentials"`) — deliberately
// not distinguished from each other, since confirming "no such user" vs
// "wrong password" is exactly the account-enumeration leak `authorize()`
// was already careful to avoid.
//
// authjs.dev/reference/core/errors — "CredentialsSignin ... code: string"

import { CredentialsSignin } from "next-auth";

export class UnverifiedEmailError extends CredentialsSignin {
  code = "unverified_email";
}

export class RateLimitedError extends CredentialsSignin {
  code = "rate_limited";
}
