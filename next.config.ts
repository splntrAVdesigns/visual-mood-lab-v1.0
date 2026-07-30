import type { NextConfig } from 'next';

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
  // Seed shaders and sketches are loaded as raw text at build/seed time.
  turbopack: {
    rules: {
      '*.frag': { loaders: ['raw-loader'], as: '*.js' },
      '*.vert': { loaders: ['raw-loader'], as: '*.js' },
    },
  },
};

export default config;
