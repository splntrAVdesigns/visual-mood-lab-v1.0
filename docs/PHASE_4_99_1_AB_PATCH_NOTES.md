# Phase 4.99.1 — A/B patch

Base: c7e6f67ffef832e11f1f7fa251679c1f8e9e1546 (main).
Status: implemented; production build/static/control-flow checks passed;
GPU and real-device visual acceptance pending. No deployment or push performed.

## Changes
- lib/gl/effects-compositor.ts: identity blits for intermediate/final VFX
  frames. DOM texture upload already handles Y. Resolves runnable programs
  first so unavailable/failed final shaders cannot discard preceding results.
  Zero/nonfinite Mix is bypassed. Async source loads deduplicate, contain
  rejection, and permit retry on the next explicit load (mount/rack update).
- lib/render/pool.ts: modulation falls back to control defaults when an older
  saved effect lacks a parameter; base state remains immutable.
- scripts/verify-vfx-chain.mjs: 15 production-code control-flow regressions.
- scripts/verify-vfx-runtime.mjs: real WebGL2 shader/pixel test harness.
- docs/IMPLEMENTATION_PLAN_SEPT20.md: A/B status and remaining scope.

No database migration, dependency changes, preset reseed, or effect-ID changes.
No per-effect compensating flips. SHAPESHIFT's existing source convention stays
intact. Linear Mirror, Quad Mirror, Point Invert (still labelled Invert), and
Math Warp preserve their authored intentional transformations. UI renaming,
media/p5 adapters, framebuffer optimization, CRT refinements and time-normalized
feedback are deferred to C/D. Existing feedback history semantics are unchanged;
a zero-Mix pass does not advance its own history while bypassed.

## Verification performed
- npm run typecheck: pass.
- npm run build: pass (Next production build and static generation).
- node --import tsx scripts/verify-effects.ts: 13 definitions, zero errors.
- node --import tsx scripts/verify-render-pool.ts: 10 passed.
- node scripts/verify-vfx-chain.mjs: 15 passed.
- ESLint: no errors; two existing no-unused-expressions warnings in pool.ts.
- GPU harness: NOT RUN TO COMPLETION. Chromium download fallback succeeded,
  but launch was denied by environment socket restrictions. No visual/device
  pass is claimed. Run the following on the development machine:

```bash
npx playwright install chromium
node scripts/verify-vfx-runtime.mjs
```

The harness bundles production compositor/registry/GLStage, loads real shader
sources, and tests all 13 shader compilations, zero Mix, neutral effects in three
aspect ratios, odd/even chain lengths, failed/missing passes, reordering, intended
mirror/invert behavior, formula selection, and echo orientation. It does not
substitute for mobile Safari or full app UI interaction tests.

## Owner acceptance
Use asymmetric text/graphic (TOP arrow, different corners) in SHAPESHIFT.
1. Confirm unchanged appearance with no VFX; activate Grain, Hue Shift, CRT,
   BrokeTV, Noise Displacement, Graphic Slice and both strobes individually.
   Source must not automatically turn upside down.
2. Test each effect Mix at 0, 0.5 and 1, plus neutral effect strengths where
   applicable. Mix 0 must match the fresh unprocessed source.
3. Run one/two/three effects, reorder, toggle, remove, and reopen the rack.
4. Confirm Linear/Quad Mirror and Invert still intentionally transform; Math
   Warp Amount 0 is neutral and both formula selections remain functional.
5. Check Turbulent Feedback/Dark Strobe echo trails align with source orientation.
6. Check parameter modulation and Mix modulation, including a saved older tile.
7. Repeat mobile Safari portrait/landscape and desktop focused/board views,
   square/wide/tall output, snapshot and short video capture.

Direct image/SVG/video and p5 VFX parity remains Stage C, not part of this patch.
If a later main changes either patched runtime file, merge this patch manually
rather than overwriting that later work. Start from a clean worktree. On a clean
base, unzip at repo root, inspect git diff, build, and commit only the six files
listed above (including this notes document). Normal push only; never force.
