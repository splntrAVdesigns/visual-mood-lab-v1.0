// lib/db/schema.auth.ts
//
// Auth tables — additive to your existing schema.ts (assets, boards, etc).
// Shape follows the @auth/drizzle-adapter contract exactly; do not rename
// columns Auth.js expects (id, userId, sessionToken, expires, etc) or the
// adapter will silently fail to read/write them.
//
// `username` and `passwordHash` are the only non-standard additions, used
// by the Credentials provider. `passwordHash` is null for GitHub-only users.

import {
  pgTable,
  text,
  timestamp,
  primaryKey,
  integer,
} from "drizzle-orm/pg-core";
import type { AdapterAccountType } from "next-auth/adapters";

export const users = pgTable("user", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text("name"),
  username: text("username").unique(),
  email: text("email").unique().notNull(),
  emailVerified: timestamp("emailVerified", { mode: "date" }),
  image: text("image"),
  passwordHash: text("passwordHash"), // null => OAuth-only account
  createdAt: timestamp("createdAt", { mode: "date" }).defaultNow().notNull(),
  // Session strategy is JWT (see lib/auth/config.ts for why — Credentials
  // provider forces this). This is how a killed session is still rejected
  // on its next request instead of surviving until JWT expiry: bump it on
  // password change / "log out everywhere" / account suspension, and the
  // jwt callback below rejects any token issued before this timestamp.
  revokedAt: timestamp("revokedAt", { mode: "date" }),
});

export const accounts = pgTable(
  "account",
  {
    userId: text("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").$type<AdapterAccountType>().notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("providerAccountId").notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
  },
  (account) => ({
    compoundKey: primaryKey({
      columns: [account.provider, account.providerAccountId],
    }),
  })
);

export const sessions = pgTable("session", {
  sessionToken: text("sessionToken").primaryKey(),
  userId: text("userId")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expires: timestamp("expires", { mode: "date" }).notNull(),
});

export const verificationTokens = pgTable(
  "verificationToken",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: timestamp("expires", { mode: "date" }).notNull(),
  },
  (vt) => ({
    compoundKey: primaryKey({ columns: [vt.identifier, vt.token] }),
  })
);
