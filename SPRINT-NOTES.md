# Visual Mood Lab v2.5 — library complete at 50

```
npm install
npm run build
```

**Reseed after deploying** — visit `/api/seed`. That run will also prune the
orphaned Chromatic Glitch row your deployment has been carrying (the reason
your seed reported 49 against a 48-entry manifest).

**Final: 50 assets — 21 shaders / 29 sketches.**

---

## 1. Orphan row — fixed permanently, not deleted once

Seeding upserted by slug but never removed anything, so an asset retired
from the manifest kept its row forever. That's why your deployment showed
`total: 49` against 48 manifest entries — leftover Chromatic Glitch from
before Particle Cube replaced it.

Fixed in the seed route itself rather than with a one-off delete, so any
future retired asset self-cleans. **Scoped to rows that have a `seedSlug`**,
so anything you upload is never touched by it.

Verified both directions, because "deletes things" deserves proof:
- Added a probe asset, seeded, removed it from the manifest, reseeded →
  `pruned: 1`, total back to 50. ✅
- Registered an upload, reseeded → upload survived, `pruned: 0`. ✅

## 2. SVG Particle (Option B, as directed)

Ships with procedurally generated source shapes — ring, grid, cross, wave,
burst — rather than a linked image. Worth being precise about why: the
texture picker from the hardening pass resolves images for **GLSL shaders
only**. There is currently no image-loading path in the p5 sandbox at all,
and carrying decoded pixel data across the postMessage boundary is a real
protocol extension. That stays on the backlog rather than being quietly
half-done here.

The sampling approach is unchanged in spirit — walk a grid, keep a particle
wherever the shape is solid — but the "is this solid" test is analytic per
shape rather than an alpha lookup into a bitmap. Faster, and the shape can
change live without re-sampling anything. 18 controls, pointer-repel and
reassembly intact.

## 3. Drift Blocks — the hero background as a real asset

Five shapes (square, circle, triangle, hexagon, octagon), full colour
control, modulatable size/speed/opacity, optional spin and jitter. 19
controls.

**The hero decoration itself is untouched, deliberately.** It lives outside
the renderer pool, which is why it never competes for the live-renderer
budget — now 1–3 slots depending on device. Wiring it into the shared
pipeline would spend one of those slots on chrome instead of on an asset
someone actually chose to watch. This is a sibling sharing the same visual
DNA, independently tunable.

The cubic ease in/out on each shape's journey is what makes the drift read
as considered rather than mechanical — per-shape durations mean the field
never pulses in unison.

## Verified this session

Typecheck and build clean · **50/50 seeded, 0 warnings** · both new assets
confirmed present with 18 and 19 controls via direct API check · prune
verified in both directions · `verify-seed` clean, all ten `ControlKind`
values still exercised.

## Next

**Mobile layout phase** — the library is closed, the foundation is measured,
nothing outstanding blocking it.
