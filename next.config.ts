import type { NextConfig } from 'next';
import { securityHeaderRules, type CspMode } from './lib/security/headers';

/*
 * CSP rollout. Both start as Report-Only: the policy is evaluated and every
 * would-be violation is POSTed to /api/csp-report (visible in the platform
 * logs as `[csp-report]`), but nothing is blocked. Promote a policy to
 * 'enforce' only after a period of real use shows no violations you'd want to
 * allow. The sandbox policy was enforced first — it's the narrow one and it
 * guards the document that runs sketch code. The app policy stays Report-Only
 * until it has seen real production traffic (uploads to Vercel Blob, media
 * playback, OAuth) that a local test can't reproduce.
 */
const APP_CSP_MODE: CspMode = 'report-only';
// ENFORCED: promoted after all 44 seed sketches were opened under it in
// Report-Only with zero violations (once `data:` was allowed for the font
// loader's local decode — the one real finding). See lib/security/headers.ts.
const SANDBOX_CSP_MODE: CspMode = 'enforce';

const config: NextConfig = {
  reactStrictMode: true,
  typedRoutes: true,
  /* PGlite ships a WASM binary and postgres-js reaches for node net directly;
     both break when bundled into the server chunk (PGlite throws on its own
     URL-based wasm path). Keep them external so they load from node_modules
     at runtime. */
  serverExternalPackages: ['@electric-sql/pglite', 'postgres'],
  /*
   * /api/seed reads seed/manifest.json, then reads whichever shader/sketch
   * files that manifest names, via fs.readFileSync(join(process.cwd(), ...)).
   * Vercel traces each serverless function's file dependencies statically —
   * it can follow import/require, but a path built at runtime from JSON
   * content isn't something static analysis can resolve, since the actual
   * filenames aren't known until the code runs. Without this, the seed
   * route could work perfectly in `next start` locally (full filesystem
   * present) and still 404 its own files once deployed, where only traced
   * files exist. Same reasoning applies to the migrations directory, read
   * via a runtime readdirSync rather than a static import.
   */
  outputFileTracingIncludes: {
    '/api/seed': ['./seed/**/*', './lib/db/migrations/**/*'],
  },
  async headers() {
    return securityHeaderRules({
      dev: process.env.NODE_ENV !== 'production',
      appCspMode: APP_CSP_MODE,
      sandboxCspMode: SANDBOX_CSP_MODE,
    });
  },
  // Seed shaders and sketches are loaded as raw text at build/seed time.
  turbopack: {
    rules: {
      '*.frag': { loaders: ['raw-loader'], as: '*.js' },
      '*.vert': { loaders: ['raw-loader'], as: '*.js' },
    },
  },
};

export default config;
