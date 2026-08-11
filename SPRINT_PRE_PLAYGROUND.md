# Pre-Playground Sprint — Seed Expansion & Copy Polish

**Blocks:** Phase 5 (Playground)
**Est:** 4–6 days
**Status:** Proposed

---

## Why this sprint exists

Two pieces of feedback surfaced during testing, both cheap to fix now and expensive to fix once Playground ships (Playground will treat the seed set as its fixture corpus and its "fork an existing asset" starting point — better to lock the library first). Copy edits are trivial but should ship in the same pass since they touch the same About surface.

**Revision note:** all 6 brainstormed "open-ended" concepts are now in scope (not just 3), and two assets moved from shader to p5 to cut technical risk. Total new assets: **13**, bringing the library to **50 → 63**.

---

## Track A — Seed library: 50 → 63

### New asset batch (13 total)

| # | Slug (proposed) | Type | Concept | Notes |
|---|---|---|---|---|
| 1 | `type-wave` | p5 sketch | Kinetic type | Text baseline distorted by a sine/noise field; letterforms ripple as the field animates. Params: amplitude, frequency, noise seed, font weight. |
| 2 | `glyph-swarm` | p5 sketch | Kinetic type | Individual glyphs as physics particles that scatter and reform into a word; pointer disturbs the swarm. Params: cohesion, scatter force, reform delay, tint. |
| 3 | `digital-matrix` | shader | Matrix code rain | Columns of ASCII/numeral/CJK glyphs scrolling and swapping — glyph texture atlas + per-column time offset, random glyph inter-change and morph. Distinct from the existing `ascii-mosaic` (luminance→glyph mapping): this one is about column motion and character churn, not image reconstruction. |
| 4 | `acid-melt` | shader | Hue-shift / psychedelic | Domain-warped noise driving continuous hue rotation; kaleidoscopic feedback loop. |
| 5 | `hue-vortex` | shader | Hue-shift / psychedelic | Spiraling hue rotation with bloom/feedback trails — more optical, moiré-adjacent, trippier than #4 so the two don't feel redundant. |
| 6 | `liquid-glass` | shader | Glass | Self-evolving color blob (metaball SDF animated by time + noise, no pointer input) sitting behind a refractive glass surface — screen-space refraction, chromatic dispersion at edges, and a recursive domain-repeat pass for fractal reflections. Fully self-animating, no interactivity risk. |
| 7 | `cursor-ripple` | p5 sketch | Cursor / touch follow | Ripple rings/particles emanating from pointer or touch position. Moved from shader to p5 — p5 gets pointer coordinates for free inside its sandboxed iframe, so this avoids adding a new live-input channel to the shader renderer for one asset. |
| 8 | `gravity-lens-ascii` | shader | Open-ended | ASCII/glyph rendering of a starfield gravitationally lensed around a moving singularity — characters bend, not just brightness-map. |
| 9 | `language-decay` | shader | Open-ended | Procedural alien script that erodes and reforms like sand — reaction-diffusion driving glyph-like structure, feels linguistic but unreadable. |
| 10 | `chorus-of-eyes` | p5 sketch | Open-ended | Field of small radial "eye" shapes that track the pointer subtly and blink asynchronously — quiet, slightly eerie ambient piece. Kept as p5 for the same reason as `cursor-ripple`: free pointer access, zero shader-side risk. |
| 11 | `wound-thread` | shader | Open-ended | Vein/thread growth via reaction-diffusion or L-system, pulsing on a slow LFO like a heartbeat — restrained palette, not literal. |
| 12 | `static-choir` | p5 sketch | Open-ended | CRT-interference aesthetic merged with an abstracted waveform, LFO-driven so it "breathes" without needing real audio input. |
| 13 | `orbit-debris` | shader | Open-ended | Raymarched cluster of tumbling fractal fragments in slow orbital decay — cold, mechanical, the odd one out tonally from the rest. |

None of these need to fit the app's own no-decoration/no-glow UI discipline — that constraint is for the chrome, not the artwork. These can be as strange as you want.

### Balance rationale

Current library sits at 21 shaders / 29 sketches. This batch lands at 8 shaders / 5 p5 sketches, bringing the total to **29 shaders / 34 sketches** — closer to even than the previous draft (delta of 5 vs. the prior delta of 8), without forcing an artificial split. Two assets (`cursor-ripple`, `chorus-of-eyes`) that could plausibly be shaders were deliberately kept as p5 specifically to avoid the live-pointer-in-shader problem below — that's a small tilt toward sketches in exchange for a real reduction in scope risk, which is worth it.

### Technical prerequisite: dropped

The earlier draft required a new `u_pointer` reserved uniform + per-frame update through `context-pool.ts`'s rAF loop, because `pointer-ripple` and possibly `paint-splat`/`liquid-glass` needed live pointer position inside a shader. With `pointer-ripple` moved to p5 (`cursor-ripple`), `liquid-glass` redesigned to be fully self-animating, and `digital-matrix` replacing `paint-splat` (no pointer dependency), **no shader in this batch needs live pointer input.** This removes the one piece of renderer-contract work from the sprint entirely — nothing new to add to `context-pool.ts`, `parse-uniforms.ts`, or `DEFAULT_RESERVED`. Worth keeping on the post-v1 backlog as a real capability (it's genuinely useful for future shader work), just not gating this sprint.

### Authoring workflow (unchanged from existing convention)

1. Author into `seed/shaders/` or `seed/sketches/` per the existing conventions (annotated `#version 300 es` for shaders; instance-mode p5 exporting a `params` object).
2. Add entries to `seed/manifest.json` (title, tags, poster hints, default params).
3. `npm run seed` against a scratch/dev DB, not against prod without `BLOB_READ_WRITE_TOKEN` set (per the existing gotcha — silent local-filesystem URLs otherwise).
4. `npx tsx scripts/verify-seed.ts` — canonical schema gate.
5. Visual QA in the board grid: poster generated, tags correct, dominant colors extracted, no console warnings.
6. Re-run the Phase 2 scroll budget (60fps @ 40+ cards) — the seed set alone is now 63, which already exceeds the original 40-card benchmark, so this is a good moment to re-measure rather than assume.
7. Re-run the Phase 3 exit criterion against all 13 new assets specifically: open, adjust every control, reload, confirm identical frame. Playground's "fork an existing asset" flow in Phase 5 depends on this holding for the whole library, not just the original 50.

---

## Track B — Copy edits (About section)

### Quadrant 2 — Library stat line
**Change to:** *"Over 50+ shaders/sketches, seeded."*
Good call making this generic rather than hardcoding a count — it stays accurate through this expansion (50→60) and future ones without needing another copy pass.

### Quadrant 1 — "01 Concept"
Current line: *"It's less a gallery, more an instrument."*
Requested addition: *"It's less a gallery and more like an instrument that you can experiment with."*

⚠️ Flagging before this goes in verbatim: appended directly after the existing line, this reads as a near-repeat of the same sentence rather than a new thought — *"It's less a gallery, more an instrument. It's less a gallery and more like an instrument that you can experiment with."* Two ways to resolve, your call:
- **Replace** the terser original with this fuller, friendlier version (likely what reads best if this is meant to soften the aphorism for a general audience).
- **Append as intended**, accepting the near-repetition as deliberate emphasis/rhythm.

Default recommendation: replace, unless the repetition is a stylistic choice you're going for.

### "Follow wherever a parameter takes it"
**Change to:** *"follow wherever a parameter leads you,"*
Straightforward find-and-replace. Note the trailing comma in your requested text — confirm it's still mid-sentence in context (i.e. this clause continues into more copy after it) before swapping in, so the punctuation doesn't orphan a fragment.

---

## Track C — Sequencing

| Order | Task | Depends on | Est. |
|---|---|---|---|
| 1 | Copy edits (Track B, all 3) | Nothing — ship independently, doesn't touch renderer code | 0.5 day |
| 2 | Author `digital-matrix`, `acid-melt`, `hue-vortex`, `liquid-glass` | Nothing | 1.5 days |
| 3 | Author `gravity-lens-ascii`, `language-decay`, `wound-thread`, `orbit-debris` | Nothing | 1.5 days |
| 4 | Author `type-wave`, `glyph-swarm`, `cursor-ripple`, `chorus-of-eyes`, `static-choir` | Nothing | 1.5 days |
| 5 | Manifest + seed + verify-seed + visual QA (all 13) | Tasks 2–4 | 0.5 day |
| 6 | Re-run scroll perf budget + Phase 3 exit criterion on full 63-asset set | Task 5 | 0.5 day |
| 7 | Bump `IMPLEMENTATION_PLAN.md` (§1 "50-asset" → "63-asset", §8 table, rev number, changelog line) | Task 6 | trivial |

No task in this pass touches the renderer contract, `context-pool.ts`, or reserved-uniform handling — every asset is buildable against the existing pipeline as-is. That's the main upside of moving the two pointer-dependent concepts to p5.

**Definition of done for this sprint:** 63 seed assets pass `verify-seed`, board scrolls at 60fps with the full seed set loaded, every new asset's controls round-trip identically after reload, the 3 copy edits are live, and `IMPLEMENTATION_PLAN.md` reflects the new count before Phase 5 kickoff.
