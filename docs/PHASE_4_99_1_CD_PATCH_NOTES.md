# Phase 4.99.1 C–D — Asset parity and VFX quality

Patch base: production `main` at `250a4d39d584f4b17839c7b5718c01238d55ce71` (A/B).
This package does not deploy, modify the database, or alter the saved effect IDs.

## Stage C — renderer parity

- Shader tiles retain the A/B path. Image, SVG, video, and snapshot tiles now
  draw a fresh, appropriately scaled, transformed and tinted source frame into
  a presentation canvas before running the same VFX chain. Media without a
  readable CORS source retains the original visible DOM element and shows an
  explicit unavailable state in the rack; it never uploads a tainted canvas.
- p5 tiles remain in their opaque-origin `sandbox="allow-scripts"` iframe.
  The host requests no more than 30 ImageBitmap frames per second, one at a
  time, at <=2048 pixels on an edge and <=2,097,152 pixels total. Only a
  validated response from the matching iframe and outstanding request can be
  copied into a host-owned presentation canvas. Every accepted, late, or
  invalid bitmap is closed; timeout, bypass, resize, swap or sketch error
  restores the original interactive iframe. The hidden iframe retains pointer
  input, and the overlay itself has `pointer-events:none`. No DOM access or
  same-origin permission is granted to sketch code.
- Desktop and mobile VFX rack affordances now cover all five asset types and
  image snapshots; sound and VCapture eligibility remain as before. Snapshot
  export from the media renderer takes the currently visible VFX canvas.

## Stage D — quality and bounded performance

- The compositor tries two reusable per-card GPU framebuffer targets for
  intermediate passes, saving intermediate canvas readback and texture upload.
  It retains the A/B CPU relay path when framebuffer allocation fails, the
  context is lost, or the two buffers would exceed 64 MiB. Targets are released
  on dispose, bypass, resizing, and context-generation change. The effect
  metrics accessor exposes per-frame pass/upload/relay counts for comparison;
  it does not claim a measured FPS gain.
- Echo persistence now uses elapsed-time exponential weighting, with resets on
  bypass, source edit, effect order/topology, resize, background-resume gap,
  and WebGL context generation change. Dark Strobe and Turbulent Feedback keep
  their distinct look and own mix/decay settings.
- CRT scanlines integrate over the actual pixel footprint, and the RGB mask
  fades when undersampled. Linear Mirror, Math Warp, Noise Displacement and
  Turbulent Feedback use aspect-aware warp coordinates. Intentional mirror and
  point-invert behavior is preserved. The catalog titles now say "Hue Shift"
  (not a true LUT) and "Point Invert" (spatial, not color inversion).

## Verification and remaining acceptance

The independent checks include TypeScript, Next production build, effects
manifest, renderer-pool and sandbox-message suites, the existing 15 A/B
compositor checks and new C/D bounded-transport/resource/feedback checks.
The production-code WebGL pixel regression script includes a side-by-side GPU
versus CPU relay comparison and all effect compilations. It requires local
Chromium and cannot run in the authoring environment where launching a browser
is denied; therefore GPU pixel/color parity and phone performance remain
**unverified** until device QA.

Run after extracting at the repo root:

```bash
npm ci
npm run typecheck
node scripts/verify-vfx-chain.mjs
node scripts/verify-vfx-cd.mjs
node --import tsx scripts/verify-effects.ts
node --import tsx scripts/verify-render-pool.ts
node --import tsx scripts/verify-sandbox-messages.ts
npx playwright install chromium
node scripts/verify-vfx-runtime.mjs
npm run build
```

Owner QA: check an asymmetric SHAPESHIFT image against Grain, CRT, mirror,
warp and feedback (single and 3-pass chains); repeat image, SVG, video, snapshot,
and an animated and paused p5 sketch. Confirm rack status while a p5 frame is
loading and CORS media fallback. Confirm p5 pointer, keys, sound and sandbox
errors still work. Compare GPU versus relay pixels, VFX on/off, square/wide/tall
dimensions, 30/60/120 FPS feedback feel, video snapshot, mobile Safari and
desktop browser. Record before/after p50/p95 frame time, memory and FPS on
each target device: allocation reduction is instrumented, not a performance
result until these measurements pass. VCapture MP4/WebM on media/p5 remains
separately scoped; this patch does not claim it.
