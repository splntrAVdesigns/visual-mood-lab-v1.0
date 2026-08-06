// lib/auth/hash.ts
//
// argon2id wrapper. OWASP-recommended params as of 2026: memoryCost 19 MiB
// minimum for interactive login; we go a bit higher since this only runs
// on auth routes, not on every request.
//
// npm i argon2

import argon2 from "argon2";

const HASH_OPTS = {
  type: argon2.argon2id,
  memoryCost: 2 ** 16, // 64 MiB
  timeCost: 3,
  parallelism: 1,
} as const;

export async function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, HASH_OPTS);
}

export async function verifyPassword(
  hash: string,
  plain: string
): Promise<boolean> {
  try {
    return await argon2.verify(hash, plain);
  } catch {
    // Malformed hash, wrong algorithm, etc — never throw into caller,
    // just fail closed.
    return false;
  }
}
