# Visual Mood Lab v2.1 — security audit fixed

```
npm install
npm run build
```

No schema change — keep your data, no reseed needed. `package-lock.json` is
included this time since the `overrides` field needs to be regenerated —
delete your old lockfile if npm complains, then reinstall.

---

## The 7 vulnerabilities — checked properly, not just patched blindly

`npm audit fix --force` wanted to **downgrade Next.js to version 9** to
satisfy its resolver. That's not a fix, that's destroying the app — Next 9
predates the App Router entirely. Checked what was actually resolved
instead of trusting the automated suggestion:

- **esbuild (moderate)** — not a real risk here, but real dead weight:
  nested three levels deep through a *deprecated* package
  (`@esbuild-kit`, which the tool's own deprecation notice says was
  "merged into tsx"). Drizzle-kit already has its own fine copy of esbuild
  elsewhere in the tree; this old one was just unused legacy baggage.
- **postcss (high, 3 CVEs)** — real, resolved at `8.4.31` via Next's
  internal dependency, patched at `8.5.18+`.
- **sharp (high)** — real, resolved at `0.34.5`, patched at `0.35.0+`.

Fixed with npm's `overrides` field — forces these three specific nested
packages up to patched versions without touching Next.js or Drizzle-kit's
own versions at all:

```json
"overrides": {
  "postcss": "^8.5.18",
  "sharp": "^0.35.0",
  "esbuild": "^0.25.0"
}
```

## Verified, not just "npm audit says 0"

- `npm audit` → **0 vulnerabilities**
- `npm ls` confirms the actual resolved versions: postcss 8.5.25, sharp
  0.35.3, esbuild deduped to one safe 0.25.12 across the entire tree
  (previously three different versions floating around)
- Full typecheck and production build still clean
- **The one dependency chain the override actually touches beyond Next's
  internals** — drizzle-kit's CLI and `tsx` (which the seed/verify
  pipeline runs on) — both confirmed still working: `drizzle-kit generate
  --help` runs fine, and a full `verify-seed` pass across all 36 assets
  still comes back clean
- Fresh seed + build + boot cycle: 36/36 created, 0 warnings, board loads

Nothing about the app's behavior changed — this is purely dependency
hygiene, verified rather than assumed.
