# Visual Mood Lab v2.0 — 36/50 assets, checkpoint

```
npm install --ignore-scripts
npm run dev
```

New manifest (36 assets, was 30) — reseed after deploying: visit
`/api/seed`. Verified fresh: 36 created, **0 warnings**, every new and
reworked asset present with correct title and control count.

---

## Honest status: this is a checkpoint, not the full 22-item sprint

10 items total were agreed (2 reworks + 8 supplied-component ports). I
completed 8 of them here with the same rigor as everything else in this
build — real verification, not just "looks right." The remaining 2 (SVG
Particle, Dot Scatter) are architecturally the most novel of the batch and
deserved their own focused pass rather than being rushed to hit a count.
Sprint 3 (10 creative-freedom originals) hasn't started, as agreed —
sequenced after Sprint 2 closes.

## The two reworks

**Strange Attractor.** Found the actual bug behind "sliders don't do
anything": three of four systems shared one generic set of sliders. Thomas
and Halvorsen got them silently rescaled by factors never shown in the UI;
**Aizawa — the most organic-looking system — ignored all three and used
hardcoded constants instead.** Moving "Constant A" while Aizawa was
selected did literally nothing. Every system now owns real, connected
constants shown only when selected. Added additive blending for vibrancy
(the original had none, which read flat next to Particle Cube).

**Transform Shape** (was Cube Transform). Five primitives via p5 WEBGL's
built-in shape functions. Breathing now defaults to 0, not 0.15 — a still
reference shape is usually what's wanted by default. Trail/echo effect
added using the same technique Particle Cube already proved. Kept the same
slug so the existing row updates in place instead of orphaning.

## Six of eight supplied-component ports

None could be dropped in as-is — every one needed real reimplementation
against this app's two renderer types, not a literal port. Two real bugs
caught during authoring rather than shipped and found later:

- **`u_mouse` arrives in pixel coordinates, not normalised 0–1.** An early
  draft of Grid Follow assumed otherwise and compared raw pixels against
  0–1 cell math — would have rendered nothing sensible.
- **Pointer position is one board-wide value with no per-card "hovering"
  signal.** An "auto-drift when idle" toggle built on that assumption was
  unbuildable — it can never detect idle, since it never sees anything but
  a valid position. Replaced with an honest Pointer/Auto-drift select
  instead of a feature that couldn't work as designed.

**Grid Follow** — DOM+CSS-3D cell grid rebuilt as one fragment shader.
**Pulse Lines** — CSS `@keyframes` (browser timing, no shader equivalent)
rebuilt as a phase-staggered travelling sine pulse. **Dot Matrix** — a real
two-pass `ogl` pipeline collapsed into one shader rather than building
general multi-pass infrastructure for a single asset. **Grid Snake** — the
most direct port; already canvas2D and deterministic. Found one real gap
while porting: cell size/gap were computed once at setup, so adjusting them
via the inspector would silently do nothing until a resize — fixed with the
rebuild-on-change pattern other sketches already use. **Star Field** —
canvas2D particle warp tunnel, physics carried over closely. **LED
Display** — bitmap font ticker, list-of-strings model collapsed to one text
field since this app has no matching control kind.

## Verified this session

Build clean · seed fresh, 36/36 created, 0 warnings · every new/reworked
asset confirmed present with correct title and expected control count via
direct API check, not just visual inspection.

## Next message

SVG Particle (needs a decision: baked default source vs. waiting on the
texture-picker stub) and Dot Scatter (SVG + framer-motion physics needs
porting to p5-native spring/brownian motion), then Sprint 3's 10 originals.
