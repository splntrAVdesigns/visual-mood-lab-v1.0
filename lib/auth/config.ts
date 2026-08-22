// lib/auth/config.ts
//
// Auth.js v5.
//
// SESSION STRATEGY — JWT, not database. This was flipped from "database"
// after a production bug: Auth.js's Credentials provider is HARD-CODED to
// issue a JWT-encoded session cookie on sign-in, regardless of the global
// `session.strategy` setting (see @auth/core/src/lib/actions/callback/
// index.ts, the `provider.type === "credentials"` branch — it always calls
// jwt.encode() and never touches the adapter's createSession()). Only OAuth
// sign-ins go through handleLoginOrRegister() and actually get a DB row.
//
// With strategy: "database" globally, every subsequent request tried to
// look up that JWT string as a literal session-token primary key in the
// `session` table, never found it, and — this is the part that made it look
// like a random logout — @auth/core's session() handler treats "token
// present but not resolvable" as an invalid session and actively deletes
// the cookie (sessionStore.clean()) before requireUser() ever runs. Net
// effect: credentials login appeared to succeed for one request, then
// self-logged-out on the very next navigation. GitHub (OAuth) never showed
// this because OAuth *does* get a real database session.
//
// This is a documented constraint, not a config oversight: "the Credentials
// provider can only be used if JSON Web Tokens are enabled for sessions"
// (@auth/core/src/providers/credentials.ts).
//
// To keep the instant-revocation property this project wanted from database
// sessions, `revokedAt` on the user is checked inside the jwt callback below
// on every request — same effective guarantee (a killed account is rejected
// on its next request, not just at JWT expiry), without fighting a mechanism
// the library won't let us override.
//
// npm i next-auth@beta @auth/drizzle-adapter

import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import GitHub from "next-auth/providers/github";
import Apple from "next-auth/providers/apple";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { users, accounts, sessions, verificationTokens } from "@/lib/db/schema.auth";
import { verifyPassword } from "./hash";
import { loginRateLimit } from "./rate-limit";

// getDb() is async — it has to decide Neon vs. PGlite before returning.
// NextAuth() needs a resolved adapter at config time, so we resolve once
// here. This runs once per server process (module is cached), same as
// getDb()'s own globalThis caching.
const db = await getDb();

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: DrizzleAdapter(db, {
    usersTable: users,
    accountsTable: accounts,
    sessionsTable: sessions,
    verificationTokensTable: verificationTokens,
  }),
  session: { strategy: "jwt" },
  // Vercel deployments don't have a fixed hostname known ahead of time
  // (preview URLs, the *.vercel.app domain, a future custom domain) the
  // way AUTH_URL would assume. Without trustHost, Auth.js can refuse to
  // trust the incoming request's host header for constructing callback/
  // redirect URLs — this is a known, previously-flagged risk for exactly
  // the "Server error / problem with the server configuration" failure
  // mode, separate from (and worth fixing regardless of) whether missing
  // env vars turn out to be the actual root cause of that error.
  trustHost: true,
  pages: {
    signIn: "/login",
    // Auth.js has no native signup page concept — /signup is a plain
    // route in (auth)/ that posts to a server action, not to this config.
  },
  providers: [
    GitHub({
      clientId: process.env.AUTH_GITHUB_ID,
      clientSecret: process.env.AUTH_GITHUB_SECRET,
    }),
    // Apple ID ("Sign in with Apple"). Goes through the same
    // DrizzleAdapter OAuth path as GitHub above — no extra code needed
    // for account creation on first sign-in; the adapter's
    // handleLoginOrRegister() creates the `user` + `account` rows the
    // same way it does for GitHub.
    //
    // AUTH_APPLE_ID is the Services ID (e.g. "com.splntr-microtools.vml.web"),
    // registered in the Apple Developer portal against this app's
    // *production* domain (visual-mood-lab.splntr-microtools.com) — Apple
    // validates the domain and does not accept localhost or preview
    // *.vercel.app hosts, so Apple sign-in can only be exercised against
    // the real deployment, not local dev or preview branches.
    //
    // AUTH_APPLE_SECRET is NOT a static secret like GitHub's — Apple
    // requires a client secret that is itself a short-lived JWT (max 6
    // months), signed with ES256 using the private key (.p8) downloaded
    // once from the Apple Developer portal, your Team ID, and your Key
    // ID. It must be regenerated and rotated in Vercel's env vars before
    // it expires (see scripts/generate-apple-secret.ts). next-auth does
    // not generate this for you.
    //
    // Apple only sends the user's name on the very first authorization
    // ever performed for a given Services ID + Apple ID pair — capture it
    // in the adapter's user-creation path if a display name matters here,
    // because it will never be sent again on subsequent sign-ins.
    Apple({
      clientId: process.env.AUTH_APPLE_ID,
      clientSecret: process.env.AUTH_APPLE_SECRET,
    }),
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials, request) {
        const email = credentials?.email as string | undefined;
        const password = credentials?.password as string | undefined;
        if (!email || !password) return null;

        // Rate limit BEFORE touching the DB — this is the brute-force
        // choke point. Keyed by email, not IP alone, so a distributed
        // attempt against one account still gets throttled.
        const { success } = await loginRateLimit.limit(email.toLowerCase());
        if (!success) {
          throw new Error("Too many attempts. Try again shortly.");
        }

        const [user] = await db
          .select()
          .from(users)
          .where(eq(users.email, email.toLowerCase()))
          .limit(1);

        // No user, or account is OAuth-only (no passwordHash) — fail
        // without revealing which case it was.
        if (!user || !user.passwordHash) return null;

        const valid = await verifyPassword(user.passwordHash, password);
        if (!valid) return null;

        if (!user.emailVerified) {
          throw new Error("Please verify your email before logging in.");
        }

        return user;
      },
    }),
  ],
  callbacks: {
    // JWT strategy: this runs on sign-in (user/account present) and on
    // every subsequent request to refresh the token (user/account absent —
    // token is all that's left). The revocation check has to live here,
    // not in `session`, because `session` never runs for a token the jwt
    // callback has already rejected.
    async jwt({ token, user }) {
      if (user) {
        // Fresh sign-in — authorize()/OAuth just verified real, current
        // credentials, so this token is valid regardless of any earlier
        // revocation. Stamp sub and return immediately: jwt.encode() sets
        // `iat` right after this callback runs, so `token.iat` does not
        // exist yet on this exact call. The refresh path below is what
        // enforces revocation, by comparing revokedAt against the iat that
        // gets set on THIS token once it's re-decoded on a later request.
        token.sub = user.id;
        return token;
      }

      // Refresh path: no `user`, so this token was decoded from an
      // existing cookie, not just issued. Reject only if the account was
      // revoked AFTER this specific token was issued — comparing against
      // `token.iat` (seconds since epoch) rather than just checking
      // "is revokedAt set at all" is what lets a fresh post-reset login
      // succeed instead of being permanently locked out by its own reset.
      if (token.sub) {
        const [row] = await db
          .select({ revokedAt: users.revokedAt })
          .from(users)
          .where(eq(users.id, token.sub))
          .limit(1);

        if (!row) return null; // deleted account
        if (row.revokedAt && typeof token.iat === "number") {
          const revokedAtSeconds = Math.floor(row.revokedAt.getTime() / 1000);
          if (revokedAtSeconds > token.iat) return null;
        }
      }

      return token;
    },
    async session({ session, token }) {
      if (session.user && token.sub) {
        session.user.id = token.sub;
      }
      return session;
    },
  },
});
