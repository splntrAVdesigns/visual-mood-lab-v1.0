# Phase 4.99.2 A–B — Baseline, VFX viewport and Particle Cube

Base: `e61ca64964e0302247f1f7df3a9a30627e3cfe51` (Phase 4.99.1 C–D on `main`).

## A — Baseline before adaptive quality changes

`?perf=1` installs an opt-in, read-only ring of the latest 900 host frames at
`window.__vmlPerf`. Each frame holds host requestAnimationFrame gap, host CPU
time, and anonymous per-tile renderer type, render duration, VFX CPU duration,
effect passes, source pixels and sandbox-reported p5 FPS. No image pixels,
asset names/IDs, account details or credentials are recorded. No adaptive
thresholds, frame-rate caps or preview quality changes have been applied.

The existing authenticated soak harness (`npm run soak`) measures per-focus
frame intervals and resource recovery; its `SOAK_ONLY`, `SOAK_MOBILE`,
`SOAK_HOLD_MS` and `SOAK_CYCLES` inputs make it useful for a repeatable
Particle Cube comparison. Browser-run results and iPhone measurements are
**not available in the authoring environment**. The 68 soak logic checks
passed, but they are not a device benchmark.

### Capture a baseline on iPhone Safari and desktop

1. Sign in, open the same board with `?perf=1`, leave it foregrounded for at
   least 15 seconds per scenario, and let the first few seconds warm up.
2. Run: Particle Cube alone with VFX off at default, Edges/1700 and
   Lattice/1700, then each with Grain, CRT, Turbulent Feedback, and a
   three-effect chain. Repeat with one static image and one video tile;
   compare preview and focused views. Keep zoom, device, and network stable.
3. Before each scenario run `window.__vmlPerf.reset()` in Web Inspector.
   Afterward, inspect `window.__vmlPerf.snapshot().frames`. Discard the first
   frame (`gapMs=0`) and warm-up frames; compute p50/p95 of `gapMs`, p95
   `cpuMs`, per-tile render/VFX durations, minimum reported p5 FPS, and
   dropped-frame ratio relative to the device display interval. Record the
   iPhone model, iOS/browser version, display mode, battery/thermal status,
   VFX chain, resolution, and asset type beside each result.
4. Run the original checkout and this patch on the same device and scenarios
   before concluding performance improved. Repeat the soak test for at least
   three focus/blur cycles to catch frame-rate or resource regressions.

The hook measures host JavaScript time; browser raster, GPU time, network,
native video decoding, and an iframe's internal render time are *not* part
of `cpuMs`. The p5 FPS value is an iframe heartbeat, not a pixel-compositor
rate. Use Safari Web Inspector and an asynchronous GPU timer where supported
for those costs. Do not interpret an empty trace as a successful benchmark.

## B — Particle Cube and viewport correction

- Particle Cube replaces up to three flat per-particle circles and per-dot
  push/pop operations with 28 reusable color buckets, up to 28 camera-facing
  core batches and 28 sparse halo batches. This follows Strange Attractor's
  existing p5 POINTS batching pattern. Its core gets a lift toward white while the
  user's Opacity continues to scale alpha. Near/far mapping follows the
  rotated view, and static jitter noise is precomputed when the distribution
  is built. If turbulence is zero and color does not depend on it, animated
  noise is skipped. Visual acceptance on real p5/iPhone WebGL is still needed:
  point-size limits, appearance, and all distributions should be inspected.
- All compositor passes use one aspect-preserving resolution bounded by the
  shared WebGL stage's actual capacity. Source/presentation canvas backing
  size remains renderer-owned; CPU/GPU intermediates, uniforms and echo
  agree on the same effective dimensions. Regression checks cover oversized
  source dimensions and add a 1600x800 four-quadrant browser pixel case.

Run local deterministic checks:

```bash
npm ci
npm run typecheck
node scripts/verify-particle-cube.mjs
node --import tsx scripts/verify-frame-profile.ts
node scripts/verify-vfx-chain.mjs
node scripts/verify-vfx-cd.mjs
node --import tsx scripts/verify-soak.ts
npm run build
```

Browser validation (Chromium installed, no sign-in for VFX pixel test):

```bash
npx playwright install chromium
node scripts/verify-vfx-runtime.mjs
```

The browser checks and phone baseline remain open until run on a device.
This patch does not claim smoother motion or implement adaptive thresholds.

### Production Particle Cube source update

`seed/sketches/particle-cube.js` is ingested into the asset database. A code
deployment alone does not change the previously stored sketch. After the new
deployment is ready, run the existing authenticated seed job against the
production database (never `--fresh`). `ingestAsset` upserts the seed asset by
slug and retains existing parameter overrides on source changes. The guarded
`POST /api/seed` route requires `ALLOW_SEED_ROUTE=1` and `SEED_ADMIN_SECRET`
on the deployment. Alternatively, `npm run seed` from a trusted machine with
its production `DATABASE_URL` and storage credentials runs the same ingest.
Check the output contains an updated `particle-cube` entry before visual QA.
Do not put secrets in a shell history or share them in a QA report.
