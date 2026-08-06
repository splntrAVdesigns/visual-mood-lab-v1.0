// types/next-auth.d.ts
//
// Auth.js's default Session type doesn't include `id` on `user` — we add
// it in lib/auth/config.ts's session callback, but TypeScript has no way
// to know that without this augmentation. Required for strict mode.

import type { DefaultSession } from 'next-auth';

declare module 'next-auth' {
  interface Session {
    user: {
      id: string;
    } & DefaultSession['user'];
  }
}
