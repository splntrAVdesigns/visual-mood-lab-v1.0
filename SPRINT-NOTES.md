# Visual Mood Lab v2.3 — Sprint 3 complete, 48 assets

```
npm install
npm run build
```

New manifest (48 assets, was 37) — **reseed after deploying**: visit
`/api/seed`. Verified fresh: 48 created, **0 warnings**, all 11 new assets
confirmed through the real ingest pipeline.

Balance: 21 shaders / 27 sketches.

---

## Count note

The brief listed ten items, but "flocking ×2" is genuinely two distinct
sketches, so the real count was eleven. All eleven landed. That puts the
library at 48, not 50 — the remaining two are SVG Particle (still held
pending the texture-picker, as agreed) plus one more to be chosen.

## The six shaders

**Mandelbrot** — uses continuous smooth-iteration colouring. Colouring by
raw integer escape count is what produces those hard contour bands you see
in naive fractal renders; subtracting the fractional overshoot turns them
into a real gradient. The Julia morph blends the iteration's *starting
conditions* rather than branching, so it's a genuine continuous morph.

**God Rays** — a real screen-space radial march. There's no scene to
occlude here, so the occluder is procedural noise. That's the honest cheat
that lets this work as a standalone asset instead of needing something
behind it.

**Wormhole** — the entire illusion is one substitution: texture by
`1/radius` instead of `y`. Because `1/r` grows without bound toward the
centre, marching it forward gives perfectly periodic depth — infinite
tunnel, no geometry, no seam.

**Grain Gradient** — grain applied in roughly perceptual space (dark
regions get less absolute noise, matching how film behaves) and doubling as
sub-LSB dither. Banding is the default failure mode of any smooth 8-bit
gradient; this is what removes it, which is why even a low grain setting
visibly cleans up the ramp.

**Kaleidoscope Wire** — deliberately the inverse of the existing
Kaleidoscope: identical polar fold, but everything stroked, so it reads as
plotter linework rather than stained glass. Antialiasing matters far more
here than in a filled shader — at these line weights, aliased strokes
shimmer badly under rotation.

**Rorschach Metaball** — mirrors the *coordinate* before evaluating the
field, not the result after. A symmetric field lets blobs merge across the
centre line; mirroring afterward would leave a visible seam.

## The five sketches

**Flocking** — textbook Reynolds boids. Spatial hashing (bin by grid cell,
only check neighbouring bins) is what keeps it near-linear instead of
O(n squared) — that's the difference between the high end of the count
slider being usable and being decorative.

**Murmuration** — deliberately *not* the same sketch with different
defaults. Real starlings differ from textbook boids in two specific ways,
both modelled: they track a fixed number of nearest neighbours regardless
of distance (topological, not metric — this is what lets density change
without the flock falling apart), and they're bound to a roost, which is
why murmurations swirl in place rather than wandering off.

**Particle Detractor** — mixed attract/repel wells. The interesting
structure is the separatrix, the line where competing forces balance, which
is why a long trail matters more here than in most particle sketches:
single frames show dots, accumulation shows the field.

**Landscape Grid** — deliberately the opposite approach to the existing
Terrain Wireframe. That one is a WEBGL mesh you orbit in true 3D; this
does hand-rolled 2D perspective division, which is what allows the
horizon-locked infinite scroll a real camera makes awkward — and it's far
cheaper, so the grid can be much denser.

**Static Energy** — midpoint displacement: same algorithm as fractal
terrain, run on a line instead of a grid. That's what gives lightning its
characteristic jaggedness at every scale.

## Verified this session

Typecheck and build clean · fresh seed 48/48 created, **0 warnings**
(including the reserved-uniform-collision check that has caught real bugs
before) · all 11 new assets spot-checked present via direct API call with
expected control counts (13–18 each) · all ten `ControlKind` values still
exercised across the library.

## Next

Two assets to reach 50, then Phase 5 (Playground) or the mobile layout
phase — your call on sequencing.
