import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

/*
 * Lint gate: `npm run lint` fails on ERRORS only. Warnings are visible but
 * don't fail; `npm run lint:strict` (--max-warnings=0) is the target to work
 * towards. Keep `eslint-config-next` on the same version as `next`.
 */
export default [
  ...nextVitals,
  ...nextTs,
  {
    ignores: ['.next/**', '.next_*/**', 'node_modules/**', 'public/**', 'seed/**', '.pglite*/**', 'next-env.d.ts'],
  },
  {
    rules: {
      // `let x!: T` assigned once LATER because a closure (e.g. a
      // ResizeObserver callback in lib/render/pool.ts) reads it first can't
      // be merged into a `const`. This is the rule's own documented option.
      'prefer-const': ['error', { ignoreReadBeforeAssign: true }],

      // Rules added with React's compiler-era eslint-plugin-react-hooks. They
      // flag patterns this codebase predates — syncing state from
      // localStorage / matchMedia in an effect (the hydration-safe way to read
      // browser-only state), and JSX built inside try/catch on server pages
      // that catch DATA-LOADING errors, which the rule's error-boundary advice
      // doesn't apply to. Kept visible as warnings rather than mass-rewriting
      // working components; not individually audited.
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/error-boundaries': 'warn',
      'react-hooks/refs': 'warn',

      // Cosmetic: a literal ' in JSX text renders fine.
      'react/no-unescaped-entities': 'warn',
    },
  },
];
