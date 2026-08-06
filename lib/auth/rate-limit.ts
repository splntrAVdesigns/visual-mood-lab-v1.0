// lib/auth/rate-limit.ts
//
// npm i @upstash/ratelimit @upstash/redis
//
// Free tier on Upstash covers this comfortably at hobby-project volume.

import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

// 5 attempts per 60s per key (email on login, IP on signup) — tight enough
// to blunt credential stuffing, loose enough that a real user fat-fingering
// their password twice never notices.
export const loginRateLimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(5, "60 s"),
  prefix: "ratelimit:login",
});

export const signupRateLimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(3, "60 s"),
  prefix: "ratelimit:signup",
});

// Keyed by email (lowercased), not IP — someone requesting resets for many
// different addresses from one IP is a different, separately-handled
// problem (Upstash/Vercel edge rate limiting), and keying by email is what
// actually stops the failure mode that matters here: spamming reset emails
// at one person's inbox.
export const resetPasswordRateLimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(3, "300 s"),
  prefix: "ratelimit:reset-password",
});
