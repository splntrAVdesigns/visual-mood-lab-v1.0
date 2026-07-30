import type { NextConfig } from 'next';

const config: NextConfig = {
  reactStrictMode: true,
  typedRoutes: true,
  /* PGlite ships a WASM binary and postgres-js reaches for node net directly;
     both break when bundled into the server chunk (PGlite throws on its own
     URL-based wasm path). Keep them external so they load from node_modules
     at runtime. */
  serverExternalPackages: ['@electric-sql/pglite', 'postgres'],
  // Seed shaders and sketches are loaded as raw text at build/seed time.
  turbopack: {
    rules: {
      '*.frag': { loaders: ['raw-loader'], as: '*.js' },
      '*.vert': { loaders: ['raw-loader'], as: '*.js' },
    },
  },
};

export default config;
