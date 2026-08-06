/**
 * Auth seam.
 *
 * requireUser() now reads the real Auth.js session — this is the
 * DB-backed, authoritative check. The proxy only does a cheap
 * cookie-presence check (see proxy.ts's own comment on why it can't
 * touch the database); this is where a stale or forged cookie actually
 * gets rejected.
 *
 * LOCAL_USER is kept and still exported as-is: scripts/seed.ts,
 * scripts/backfill-posters.ts, and app/api/seed/route.ts import it
 * directly rather than going through requireUser(), since they run
 * outside a request context (no cookies() available) and seeded data
 * needs a stable, predictable owner regardless of who's logged in when
 * the seed script runs. Nothing about this change touches those.
 */

export interface User {
  id: string;
  name: string;
}

export const LOCAL_USER: User = { id: 'local', name: 'Local' };

export async function requireUser(): Promise<User> {
  // Deliberately a dynamic import, not a static one at the top of this
  // file. scripts/seed.ts, backfill-posters.ts, and api/seed/route.ts
  // only ever need LOCAL_USER — but a static `import { auth } from
  // './config'` here would drag config.ts's top-level `await getDb()`
  // into every one of those import graphs too, even though they never
  // call requireUser(). That's harmless inside Next.js itself, but tsx
  // compiles standalone scripts as CJS, which doesn't support top-level
  // await at all — breaking `npm run seed` outright. Loading config.ts
  // lazily, only when requireUser() actually runs inside a real request,
  // keeps the two worlds from colliding.
  const { auth } = await import('./config');
  const session = await auth();
  if (!session?.user?.id) {
    throw new UnauthorizedError();
  }
  return {
    id: session.user.id,
    name: session.user.name ?? session.user.email ?? 'Account',
  };
}

export class UnauthorizedError extends Error {
  readonly status = 401;
  constructor() {
    super('Not signed in');
  }
}
