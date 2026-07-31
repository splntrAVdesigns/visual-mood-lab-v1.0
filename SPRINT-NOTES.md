# Visual Mood Lab v2.2 — Sprint 2 complete, real bugs found and fixed

```
npm install
npm run build
```

New manifest (37 assets, was 36) — reseed after deploying: visit
`/api/seed`. Verified fresh: 37 created, **0 warnings**, every fixed and
new asset confirmed present.

---

## Dot Scatter — the trickiest port in the batch, now done

The original used framer-motion springs rendering real SVG `<rect>`
elements. Neither exists inside this app's sandboxed p5 iframe — only p5
itself is vendored in. Replaced with a hand-rolled spring integrator
(plain velocity/acceleration toward a target, damped each frame) and
canvas primitives instead of SVG. The glyph mark data and text-layout math
carried over unchanged — pure geometry, no DOM involved.

Word-hit-testing turned out to be the *easy* part, which is the opposite of
how Grid Follow went a few days ago: a p5 sketch runs in its own iframe and
gets real `mouseX`/`mouseY` local to itself, so "is the pointer over this
card" is a plain bounds check — no shared-pointer, no-idle-signal problem
this time.

**SVG Particle held, as agreed** — waiting on the texture-picker.

**Sprint 2 is now complete: 8 of 9 supplied components landed.**

---

## Codebase health check — two real issues found, not just reviewed

You asked specifically about RAF loops, memory leaks, and asset
accumulation. Went through the render pool, both renderer dispose() paths,
observer/timer cleanup, and the modulation bus. Two real, confirmable
problems, fixed:

**Modulation bus leak.** `forget()` — the function that clears a routing's
smoothing history — was only ever called when a routing was explicitly
removed. It was never called when the *card itself* went away: scrolled
off-screen, evicted by the live-renderer budget, or deleted. Every
modulated card anyone ever viewed left a permanent, unreachable entry
sitting in the bus's internal map. Fixed in `pool.demote()`, which now
forgets every routing a card had before removing it — the actual "over
accumulation" bug in the codebase.

**Dangling capture timers.** Every poster capture set a 3-second fallback
timeout that never got cancelled, even when the capture succeeded
immediately or the renderer was disposed. Small, but it's exactly the kind
of thing that compounds — fixed both paths.

Everything else checked out clean: the single shared RAF loop correctly
skips zero-size (offscreen) entries, catches per-renderer errors without
crashing the whole loop, `IntersectionObserver`s and hover timers in
`RendererStage` are all properly disconnected/cleared on cleanup, and the
shader program cache is naturally bounded by the seed library size (worth
revisiting once the Playground phase lets people generate new shader
sources at runtime, but not a problem with the current fixed library).

## Grid Follow's pixelation — found the actual cause

`step()` — a hard binary threshold with zero antialiasing. Every pixel is
either fully on the grid line or fully off it. Every other shader in this
library uses `fwidth()`-based `smoothstep()` for edges; this one just
hadn't followed that convention. Fixed to match.

**While fixing it, swept the whole shader library for the same pattern**
rather than just patching the one asset you flagged:

- **Dot Matrix**'s square-dot mode had the identical unantialiased `step()`
  sitting right next to its round-dot mode's correct antialiased version.
- **Truchet Weave** — dormant since an earlier sprint, unrelated to this
  batch — had a genuinely broken line: `(1.0 - smoothstep(...)) * 0.0 +
  step(...)`. The `* 0.0` silently zeroed out the intended antialiased
  term, leaving only a hard-edged fallback active for its tile-boundary
  overlay. Caught and fixed the polarity too — my first attempt at fixing
  it inverted the highlight (centers instead of edges), caught before
  shipping by checking the math against what `step()` was actually doing.

All three verified through the real shader-schema pipeline, not just
eyeballed.

## Verified this session

Typecheck and build clean · fresh seed 37/37, 0 warnings · every touched
asset (dot-scatter, grid-follow, dot-matrix, truchet-weave) confirmed
present with correct control counts via direct API check.

## Next

Sprint 3: the 10 creative-freedom originals (Mandelbrot, God Rays,
Wormhole, Grain Gradient, Kaleidoscope 2.0, Rorschach Metaball as GLSL;
Flocking ×2, Particle Detractor, Landscape Wireframe Grid, Static Energy as
p5), to close out the 50-asset target.
