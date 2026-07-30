/**
 * Auth seam.
 *
 * Phase 1 is single-user, so this returns a fixed local owner. Every route
 * and every query already goes through `requireUser()` and scopes by
 * `ownerId`, which means adding Auth.js later is a change to this file and
 * nothing else — no route rewrites, no data migration.
 *
 * Deferring auth is not the same as designing without it.
 */

export interface User {
  id: string;
  name: string;
}

export const LOCAL_USER: User = { id: 'local', name: 'Local' };

export async function requireUser(): Promise<User> {
  // Phase 2+ replacement:
  //   const session = await auth();
  //   if (!session?.user) throw new UnauthorizedError();
  //   return { id: session.user.id, name: session.user.name };
  return LOCAL_USER;
}

export class UnauthorizedError extends Error {
  readonly status = 401;
  constructor() {
    super('Not signed in');
  }
}
