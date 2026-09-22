# Shapeshift — Mood Tile #100 & the Shape Source Primitive

**Status:** concept, decisions locked, not started. No code in the repo yet.
**Roadmap slot:** Phase 4.99 — lands **after 4.97 MIDI** (mostly shipped; gamepad QA this week) and **before 4.95 Media Library**, 5 Playground, and 5.5 Blend & Mask.
**Companion artifact:** `shapeshift-mockup.html` — interactive WebGL2 prototype of the full pipeline, used to tune motion feel before any GLSL enters `seed/`.

---

## 0. Decisions locked (2026-09-22)

| # | Decision | Answer |
|---|---|---|
| 1 | Tile name | **Shapeshift** (`slug: shapeshift`) |
| 2 | Cross-tile masking in this tile? | **No.** Stays in Phase 5.5. Shapeshift ships internal fills only. |
| 3 | Sequencing | **Before 4.95 Media.** The upload path works without the Media page; the "Library" source plugs in when 4.95 ships. |
| 4 | Upload scope | **Per-tile only.** No reusable user shape library in v1. |
| 5 | Fonts | **The curated set already used by existing text tiles** (Type Wave, Glyph Swarm, Type Grid). No user font upload. Exact family list confirmed from source in Stage 1. |

---

## 1. Summary

Shapeshift is a shader tile that takes a **shape** (typed text, an uploaded SVG, or a transparent PNG / opaque image), converts it to a signed distance field, and renders it as an audio-reactive abstract animation built from repeated elements, gradients, and three motion systems: **Strip Warp**, **Column Step**, and **Shard Shift**.

It is built on a new reusable primitive, **Shape Source** (`lib/shape-source/`), which turns any text/SVG/image into a cached GPU texture. Shapeshift is Shape Source's first consumer. Phase 5.5's mask-asset reference is its second — which also resolves Phase 5.5 decision #6 (§11 of the main plan) in favor of **offscreen GL texture**.

### In scope (v1)

- Shape sources: Text, Upload (SVG / PNG / WebP / JPG), Library (stub until 4.95).
- Transform: rotate, scale, position, 3D tilt X/Y, mirror, invert.
- Fills: Gradient, Element Grid, Metaballs, Noise Mesh, Solid.
- Motion: None, Strip Warp, Column Step, Shard Shift.
- Depth Stack (pseudo-extrusion), chromatic split, outline, cut lines, inflate/breathe, edge wobble.
- Full modulation-bus, VFX rack, MIDI/gamepad, Roll/Mutate, and video export compatibility — all inherited by being a standard shader tile.

### Out of scope (v1)

- Masking another tile's output (Phase 5.5 — adds a sixth fill, "Tile").
- Custom element atlas (a second SVG as the repeated element) — v1.1.
- User font upload.
- Saved/reusable shape library across tiles (revisit with 4.95).
- p5 tiles as mask content (blocked by sandbox canvas access; see §10).

---

## 2. Reference → technique map

| Reference | Technique | Shapeshift feature |
|---|---|---|
| "A" smear, TYPE SENSES rows | Slit-scan: strips offset along their axis by wave + noise | Motion: **Strip Warp** (soft or hard strips, any axis angle) |
| Owner spec | Independent columns stepping on quantized time, each with its own gradient segment | Motion: **Column Step** |
| INSIDE shards, CREATE/DESTROY glitch | Random cut lines partition the plane; each region translates/rotates; cut lines drawn as hairlines | Motion: **Shard Shift** (re-cut on trigger/transient) |
| Sonic Grain, glyph vase | Shape filled with a grid of repeated elements; size by depth-into-shape; perspective tilt; RGB split | Fill: **Element Grid** + Transform tilt + chromatic split |
| Ribbon letters (Image 12) | Shape drawn N times with offset + shaded gradient | **Depth Stack** |
| CREATE / DESTROY / REBUILD | One word per line, each line scaled to fill width | Text layout: **stack words, justify each line** |

---

## 3. Architecture

```
            ┌────────────────────── lib/shape-source/ ───────────────────────┐
 Text ─────▶│ text-layout.ts   stack words → per-line fit → Canvas2D raster │
 SVG  ─────▶│ svg-load.ts      sanitize → size from viewBox → <img> raster  │
 PNG/JPG ──▶│ image-load.ts    alpha or luminance key, threshold, invert    │
            │        │                                                        │
            │        ▼                                                        │
            │ sdf.worker.ts    512² alpha → Felzenszwalb EDT → signed field  │
            │        │                                                        │
            │        ▼                                                        │
            │ cache.ts         content-hash → R8 texture in shared GL pool   │
            └────────┬───────────────────────────────────────────────────────┘
                     │  sampler2D u_shape  (+ u_shapeAspect)
                     ▼
     shapeshift.frag:  Motion(p) → InverseTransform → sample SDF → Fill → Stack/Chroma → Out
                     │
                     ▼
     existing FBO → VFX rack (4.96) → card canvas blit
```

**Design principle:** Shape Source knows nothing about Shapeshift. It exposes `getShapeTexture(spec) → { texture, aspect, hash }`. Phase 5.5 calls the same function for its mask reference.

### Shader pipeline order (and why)

1. **Motion first, on screen-space `p`.** Strip/Column/Shard displace *where we read the shape from*. Doing motion before the transform means strips stay screen-aligned (or at their own angle) regardless of shape rotation — matches every reference.
2. **Inverse transform** (tilt → rotate → scale → offset) maps displaced `p` into shape texture space.
3. **Sample SDF**, apply inflate (bass) and wobble (noise) to the distance value.
4. **Fill** colors the covered region. Element Grid samples the SDF at the **cell centre** (one extra fetch), which is what makes elements whole rather than clipped.
5. **Depth Stack** repeats 1–4 with a growing offset, compositing back-to-front with shading.
6. **Chromatic split** evaluates the scene at three offsets for R/G/B.

---

## 4. Control schema (draft uniform list)

Uses the real annotation syntax from `parse-uniforms.ts` (§8 of the main plan). Groups map to Inspector sections. Final ranges tuned in the mockup, then copied here before Stage 3.

```glsl
// ── Source ──
uniform sampler2D u_shape;    // @label(Shape) @group(Source)            ← see §6, provided by Shape Source
uniform int   u_sourceMode;   // @label(Source) @select(Text=0 | Upload=1 | Library=2) @default(0) @group(Source) @nomod
// text / file / font / case / justify are non-uniform params — see §6

// ── Transform ──
uniform float u_rotation;     // @label(Angle) @range(-180, 180) @default(0) @unit(°) @group(Transform) @mod
uniform float u_scale;        // @label(Scale) @range(0.2, 3) @default(1) @group(Transform) @mod
uniform vec2  u_offset;       // @label(Position) @range(-1, 1) @default(0.0, 0.0) @group(Transform)
uniform vec2  u_tilt;         // @label(Tilt) @range(-1, 1) @default(0.0, 0.0) @group(Transform) @mod
uniform int   u_mirror;       // @label(Mirror) @select(None=0 | Horizontal=1 | Vertical=2 | Quad=3) @default(0) @group(Transform)
uniform bool  u_invert;       // @label(Invert shape) @default(false) @group(Transform)

// ── Fill ──
uniform int   u_fill;         // @label(Fill) @select(Gradient=0 | Element grid=1 | Metaballs=2 | Noise mesh=3 | Solid=4) @default(1) @group(Fill)
uniform vec3  u_color1;       // @label(Color A) @color @default(1.0, 0.36, 0.30) @group(Fill)
uniform vec3  u_color2;       // @label(Color B) @color @default(0.62, 0.45, 1.0) @group(Fill)
uniform vec3  u_color3;       // @label(Color C) @color @default(0.20, 0.55, 1.0) @group(Fill)
uniform float u_gradAngle;    // @label(Gradient angle) @range(-180, 180) @default(0) @unit(°) @group(Fill) @mod
uniform float u_gradScroll;   // @label(Gradient drift) @range(0, 2) @default(0.2) @group(Fill) @mod
uniform int   u_rows;         // @label(Rows) @range(4, 120) @default(40) @group(Fill)
uniform int   u_cols;         // @label(Columns) @range(4, 200) @default(60) @group(Fill)
uniform float u_elemSize;     // @label(Element size) @range(0.1, 1.5) @default(0.8) @group(Fill) @mod
uniform int   u_element;      // @label(Element) @select(Dot=0 | Pill=1 | Bar=2 | Ring=3 | Diamond=4 | Zero=5) @default(1) @group(Fill)
uniform float u_depthSize;    // @label(Depth sizing) @range(0, 1) @default(0.6) @group(Fill) @mod

// ── Motion ──
uniform int   u_motion;       // @label(Motion) @select(None=0 | Strip warp=1 | Column step=2 | Shard shift=3) @default(1) @group(Motion)
uniform float u_amount;       // @label(Amount) @range(0, 1) @default(0.35) @group(Motion) @mod
uniform float u_speed;        // @label(Speed) @range(0, 3) @default(0.6) @group(Motion) @mod
uniform int   u_count;        // @label(Count) @range(2, 96) @default(18) @group(Motion)        // strips / columns / cuts (cuts clamped to 8)
uniform float u_axis;         // @label(Axis) @range(-90, 90) @default(0) @unit(°) @group(Motion) @mod
uniform float u_frequency;    // @label(Frequency) @range(0, 8) @default(2) @group(Motion)
uniform float u_softness;     // @label(Softness) @range(0, 1) @default(0.3) @group(Motion)    // hard strips ↔ continuous smear
uniform float u_shardSeed;    // @label(Re-cut) @hidden                                       // driven by trigger control, see §7
uniform bool  u_cutLines;     // @label(Cut lines) @default(true) @group(Motion)

// ── Depth & edge ──
uniform int   u_stack;        // @label(Depth stack) @range(1, 16) @default(1) @group(Depth)
uniform vec2  u_stackOffset;  // @label(Stack offset) @range(-0.1, 0.1) @default(0.0, -0.012) @group(Depth) @mod
uniform float u_chroma;       // @label(Chroma split) @range(0, 0.05) @default(0.006) @group(Depth) @mod
uniform float u_inflate;      // @label(Breathe) @range(-0.2, 0.2) @default(0) @group(Depth) @mod
uniform float u_wobble;       // @label(Edge wobble) @range(0, 0.2) @default(0.02) @group(Depth) @mod
uniform float u_outline;      // @label(Outline) @range(0, 0.05) @default(0) @group(Depth)
uniform vec3  u_bg;           // @label(Background) @color @default(0.0, 0.0, 0.0) @group(Depth)
```

**Uniform count check:** ~34 user uniforms + reserved. Well inside WebGL2's guaranteed `MAX_FRAGMENT_UNIFORM_VECTORS` (224). No packing needed.

**Int-vs-float rule reminder:** `u_rows`, `u_cols`, `u_count`, `u_stack` are steppers and **must stay `int`** (see main plan §8 — a `float` silently becomes a slider). Anything that should modulate smoothly stays `float`.

---

## 5. Shape Source specification

### 5.1 Text

- **Split** on whitespace; **one word per line** (the "auto-stack on every space" behavior). A `Line break: word | natural` option is cheap to add later; v1 is word-per-line only.
- **Layout:** measure each word at a reference size; `Justify each line = on` scales each line so its width equals the frame width (poster look). `off` uses one uniform size = the widest line fitting the frame.
- **Vertical fit:** if the stacked block exceeds the frame height, all lines scale down uniformly. Leading is a param (`0.8–1.2`, default `0.9`).
- **Case:** As typed / UPPER. **Fonts:** the existing curated set (confirm list in Stage 1). **Must `await document.fonts.load(\`${weight} 100px ${family}\`)` before rasterizing** — otherwise the first raster uses the fallback font silently.
- **Debounce** re-raster at 150 ms while typing. The Inspector text-control focus-steal bug is already fixed (memoized `onClose`), so live typing is safe.

### 5.2 SVG upload

1. Read as text. Reject > 2 MB.
2. **Sanitize** (client for preview, **server at ingest for storage**): strip `<script>`, `<foreignObject>`, all `on*` attributes, `javascript:` URLs, and any `href`/`xlink:href` not starting with `#` or `data:image/`.
3. **Normalize size:** if `width`/`height` missing, set them from `viewBox`. Firefox rasterizes dimensionless SVGs at 0×0 or 300×150 otherwise.
4. Rasterize via `new Image()` from a same-origin Blob URL (image context never executes script), draw "contain" into the 512² canvas with padding.
5. Fills keep their own alpha; **color is irrelevant** — the SDF only uses coverage. So the `currentColor` normalization needed for 4.95 is *not* needed here.

### 5.3 Raster images (PNG / WebP / JPG)

- `Key: Alpha | Luminance`, `Threshold`, `Invert`. Transparent PNG → Alpha; JPG → Luminance (auto-selected by whether the image has any alpha < 1).
- Hard 1-bit alpha stair-steps in the SDF; apply a 1 px blur to the coverage before thresholding.

### 5.4 SDF generation

- Resolution **512²** (fixed; ~0.26 MP). Felzenszwalb–Huttenlocher 1D squared EDT, run twice (inside, outside), `d = dOut − dIn`.
- **Encoding:** `R8`, `value = clamp(0.5 + d / (2·spread), 0, 1)`, `spread = 48 px`. Linear filtering on R8 is universally supported in WebGL2 (unlike float textures).
- Runs in a **Worker**. Target < 40 ms per regenerate on a mid laptop; verify in Stage 1.
- **Python numeric check first** (per ways-of-working): implement EDT standalone, verify against brute-force distance on a 64² test shape, max error ≤ 1 px.

### 5.5 Cache & lifetime

- Key: SHA-1 of `(sourceMode, text, font, case, justify, leading | fileHash, key, threshold, invert)`.
- LRU of 8 textures in the pool; eviction deletes the GL texture. Two Shapeshift tiles with identical sources share one texture.
- On context loss/restore, the pool re-requests from Shape Source (the raster canvas is kept; SDF re-run only if the canvas was dropped).

### 5.6 Persistence (per-tile)

- Uploaded file → existing signed-URL upload flow → Vercel Blob. The tile's params store **`shapeFileUrl`** (+ `shapeFileHash`, `shapeFileKind`). Never base64 in params.
- **CORS:** loading a Blob URL into a canvas that feeds `texImage2D` taints unless `img.crossOrigin = "anonymous"` and the Blob response carries `Access-Control-Allow-Origin`. **Verify on day one of Stage 1** against the real production bucket.
- Deleting the tile does not delete the Blob in v1 (matches existing per-card media behavior — confirm).

---

## 6. Renderer contract — what is actually new

**Correction to the first-pass recommendation:** the main plan already documents `sampler2D → texture` control kind (used by `ascii-mosaic`, and `feedback-trails` with `allowSelf`) and reserves `u_fft` / `u_audioTexture`. So texture binding in `pool.ts` is **not** new work. What is new:

1. **A shape-source provider for a sampler.** Today a texture control presumably binds a user image or the tile's own backbuffer. Shapeshift needs a sampler whose texture is *produced* by Shape Source from a group of non-uniform params. Proposed annotation: `// @shape` on the sampler, which tells the renderer to resolve it through `getShapeTexture()` using the tile's `shape*` params instead of the default texture control.
2. **Non-uniform params on a shader tile.** Text, font, case, justify, leading, file URL, key, threshold. Shaders currently get their schema purely from uniforms. Options:
   - **(a)** A companion `shapeshift.params.ts` merged into the schema at ingest; or
   - **(b)** A small fixed "Shape Source control group" injected by the renderer whenever a sampler carries `@shape`.
   **Recommend (b):** any future shader (including Playground-authored ones) gets the full source UI by adding one annotation, and Phase 5.5 reuses the same group for its mask picker.
3. **A `file` control kind** in the Inspector (upload button + filename + remove), backed by the existing upload flow.

**Must read before Stage 2** (no guessing): `lib/gl/parse-uniforms.ts`, `lib/gl/pool.ts` texture-unit allocation, the texture control's current Inspector component, and how `ascii-mosaic` receives its source. If the existing texture control already accepts an uploaded image per tile, item 3 largely exists and scope drops again.

---

## 7. Audio, modulation, VFX, MIDI

- **Modulation bus:** every `@mod` uniform above is a bus target by name. Defaults via `defaultAmountFor()` / `defaultSmoothingFor()`; `pickSafestModulationTarget()` should pick **`u_amount`** (never `u_scale`, which reads as jitter).
- **Recommended default routings** (applied when a user first enables audio on the tile): Bass → `u_amount` and `u_inflate`; Mid → `u_elemSize`; High → `u_chroma`.
- **Per-strip frequency mapping:** v1 blends reserved `u_bass`/`u_mid`/`u_high` across strip index (low strips ← bass, high ← treble). If `u_fft` / `u_audioTexture` is actually populated for shader tiles today, v1.1 samples it per strip directly. **Verify in Stage 2.**
- **Shard re-cut:** a `trigger` control (existing kind) increments `u_shardSeed`; transient detection routes to it the same way other trigger params are modulated. The shader eases between old and new cuts over ~250 ms so re-cuts snap, not pop.
- **Normalization:** relies on the existing baseline-deviation `BandAutoGain`. Do not add tile-local normalization.
- **VFX rack:** standard shader FBO → inherits all 3 slots. Graphic Slice + Shard Shift and Turbulent Feedback + Strip Warp are the pairs to QA.
- **MIDI/gamepad (4.97):** inherited. Suggested default pad map for the preset: Re-cut (trigger), Motion (cycle), Amount (CC), Angle (CC).
- **Roll/Mutate:** Shapeshift is the best showcase in the library; Roll must never touch Source params (don't randomize the user's text away).

---

## 8. Performance budget

Per-pixel worst case (Element Grid + Stack 16 + Chroma on): 16 layers × 3 channels × 2 SDF fetches ≈ **96 texture fetches**, plus cheap math. Acceptable at card size; at fullscreen this is where it can stutter.

- Counts as **1** live renderer against the ≤6 budget (Shape Source raster is not a live renderer).
- **Guard:** when `u_stack × (chroma>0 ? 3 : 1) > 24`, the renderer halves `u_stack` in `preview` quality. Full quality in focused/fullscreen/export.
- This tile is the natural first candidate for the per-tile adaptive resolution scaling already on the horizon.
- Shard mode with 8 cuts = 256 regions, computed analytically (8 line tests per sample) — no loops over regions.
- No `fwidth()` anywhere (fixed-width AA from `u_resolution`), `mod(u_time, TAU)` on all trig inputs.

---

## 9. Security & sharp edges checklist

- [ ] SVG sanitized client-side (preview) **and** server-side (ingest) — never trust only the client.
- [ ] SVG `width`/`height` injected from `viewBox`.
- [ ] Blob CORS verified; `crossOrigin="anonymous"` set before `src`.
- [ ] `document.fonts.load` awaited before text raster.
- [ ] Upload size caps: SVG 2 MB, raster 10 MB, raster downscaled to 1024 max before SDF.
- [ ] Empty text → render a neutral placeholder shape, never a black tile.
- [ ] Degenerate SDF (all inside / all outside) handled: shader shows fill or nothing, no NaN.
- [ ] Shape texture unit does not collide with VFX echo buffer / backbuffer units.
- [ ] `SANDBOX_RUNTIME_VERSION` bump only if sandbox code is touched (it shouldn't be — this is a shader tile).

---

## 10. Phase 5.5 hand-off contract

What 5.5 gets for free from this phase:

- `getShapeTexture(spec)` — mask source for `BlendState.maskAssetRef`.
- The injected Shape Source control group — reused as the mask picker UI.
- The SDF encoding — lets 5.5 offer **soft mask edges, feather, inflate, and outline** as mask controls, not just a hard alpha clip.
- A sixth Shapeshift fill, **"Tile"**, which samples another tile's FBO — this is the owner's original "mask any tile into the uploaded shape" concept, delivered as a 5.5 feature with no Shapeshift redesign.

Still open for 5.5 (not decided here): p5 tiles as content. Candidate path to **prototype**, not commit: inside the sandbox, `createImageBitmap(canvas)` → `postMessage` with transfer. Works without `allow-same-origin`; would also unblock the p5 VFX tab. Per-frame cost must be measured first.

---

## 11. Sprint plan

Each stage ends with a checkpoint; next stage does not start until the owner signs off.

**Stage 0 — Mockup tuning (this doc's companion).**
Tune motion feel, ranges, and defaults in `shapeshift-mockup.html`. Copy final numbers back into §4.
*Exit:* owner approves look and feel of all three motion modes and the element grid.

**Stage 1 — Shape Source module.**
Read existing text tiles for the font list. Python EDT verification. `text-layout.ts`, `svg-load.ts`, `image-load.ts`, `sdf.worker.ts`, `cache.ts`. CORS check against production Blob.
*Gates:* `tsc --noEmit`, a node verifier (`verify:shape-source`) covering layout fitting, sanitizer cases, and EDT error bounds.
*Exit:* a debug route or test page shows the SDF texture for text, SVG, PNG, JPG.

**Stage 2 — Renderer contract.**
Read `parse-uniforms.ts`, `pool.ts`, texture control, `ascii-mosaic` wiring. Add `@shape`, injected control group, `file` control kind. Confirm `u_fft` status.
*Gates:* existing 37 parse-uniforms assertions still pass + new ones for `@shape`; `verify-seed` green on all 99 existing assets (no regressions).

**Stage 3 — `shapeshift.frag`.**
Python prototype of Strip / Column / Shard math first. Build in order: transform → SDF sample → Gradient & Element Grid → Strip → Column → Shard → Metaballs, Noise Mesh, Solid → Stack → Chroma → Outline/Cut lines.
*Gates:* `glslangValidator -S frag` every step.

**Stage 4 — Integration.**
Manifest entry, modulation defaults, trigger wiring, preset defaults, poster check.
*Gates:* `verify-seed` (100 assets), `verify-effects`, `npm run build`.

**Stage 5 — QA.**
Chromium / Safari / Firefox upload paths; mobile Inspector typing; fullscreen performance; VFX pairs; MIDI pad map; video export of each motion mode.
*Exit:* owner-tested on Vercel preview, merged.

---

## 12. Seed manifest entry (draft)

```json
{
  "slug": "shapeshift",
  "type": "shader",
  "file": "shaders/shapeshift.frag",
  "title": "Shapeshift",
  "tags": ["shape", "type", "mask", "svg", "audio-reactive", "generative"]
}
```

Reminder from the seed playbook: seeding upserts `assets` only. Existing boards will not get tile #100 automatically — same backfill handling as previous batches.

---

## 13. Remaining open questions (resolved by reading source, not by owner)

1. Exact curated font families used by Type Wave / Glyph Swarm / Type Grid, and how they're loaded.
2. Does the existing texture control already support a per-tile user image upload?
3. Is `u_fft` / `u_audioTexture` populated for shader tiles today, or reserved only?
4. Texture-unit allocation strategy in `pool.ts` vs. the VFX compositor.
5. Blob lifecycle when a tile holding an uploaded file is deleted.
