# VFX Rack — Architecture & Effects Reference

**Project:** Visual Mood Lab
**Subsystem:** GPU post-processing / VFX rack (Phase 4.96)
**Source reviewed:** `effects/manifest.json` + all 12 files in `effects/shaders/*.frag` (13 manifest entries — White Strobe reuses Dark Strobe's shader file)
**Status:** Documents the rack as shipped and closed out per `IMPLEMENTATION_PLAN_AUG_22.md` §7 Phase 4.96
**Companion docs:** `IMPLEMENTATION_PLAN_AUG_22.md` (§3 Architecture principles, §7 Phase 2 / Phase 4.96, §9 Performance budget), `video-export-architecture.md` (the capture side of the same FBO/canvas pipeline)

---

## 1. What this system is

The VFX rack is a **GPU post-processing chain** that sits between a live tile's own rendered frame and the final image blitted to its card canvas. Every mood tile — shader, p5 sketch, image, video — already renders into an FBO under the shared WebGL2 context (`lib/gl/context-pool.ts`, Phase 2). The VFX rack inserts itself as one more step in that existing pipeline: **up to three effects, chained in order, per tile**, each one a full-screen fragment shader pass that reads the previous stage's output and writes a new frame.

This is explicitly *not* a new rendering subsystem. Per `IMPLEMENTATION_PLAN_AUG_22.md` §7 Phase 2's own framing: the FBO-per-tile / blit-to-canvas design was built to make exactly this kind of compositing insertion "a natural extension rather than a new subsystem." The effects compositor (`lib/gl/effects-compositor.ts`) sits between the tile's own render-to-FBO step and the final blit — nothing upstream or downstream of it needed to change shape to support it.

---

## 2. Where it lives in the codebase

```
effects/
├─ manifest.json              # the effect registry — one entry per effect,
│                              # declaring its id, title, family, shader file,
│                              # and its full Control (param) list
└─ shaders/
   ├─ dark-strobe.frag        # also serves the "white-strobe" manifest entry
   ├─ linear-mirror.frag
   ├─ quad-mirror.frag
   ├─ invert.frag
   ├─ math-warp.frag
   ├─ hue-shift.frag
   ├─ grain.frag
   ├─ crt.frag
   ├─ noise-displace.frag
   ├─ slice.frag              # manifest id: "graphic-slice"
   ├─ turbulent-feedback.frag
   └─ broke-tv.frag

lib/gl/
├─ effects-compositor.ts      # the wrapper/runtime: uniform binding, echo
│                              # buffer management, the 3-effect chain,
│                              # final mix blend
├─ context-pool.ts            # shared WebGL2 context, FBO-per-tile render
│                              # targets (Phase 2) — the compositor's host
└─ program-cache.ts           # shader program compilation/caching, shared
                               # with the main tile-renderer path

lib/effects/                  # effect TYPE definitions + registry glue
│                              # (EffectDefinition, EffectFamily, usesEcho)
renderers/control-schema.ts   # shared Control/ControlKind types — the same
                               # schema shape @-tag-annotated GLSL uniforms
                               # and effect manifest params both compile into
features/inspector/VfxPanel.tsx  # the UI: family-grouped effect picker,
                               # up to 3 active slots, per-effect param
                               # controls, "Sources / Triggers"-style
                               # disclosure pattern
```

Each `Asset` carries an optional `effectsState` field (up to 3 chained effects with their param values) — see `IMPLEMENTATION_PLAN_AUG_22.md` §6 Data model.

---

## 3. The effect authoring contract

Every effect shader is a **self-contained GLSL fragment shader file** that implements exactly one function:

```glsl
vec4 fxMain(vec2 uv) -> vec4
```

`uv` is the normalized (0–1) sample coordinate for the pixel currently being shaded. The function returns the final RGBA color for that pixel. That's the entire contract — nothing else is required from the file.

### What the wrapper supplies (never declared inside an effect file)

`lib/gl/effects-compositor.ts` injects a standard set of uniforms and helper functions into every effect shader before compiling it, so individual effect files never declare these themselves:

| Symbol | Kind | Purpose |
|---|---|---|
| `u_fxSource` | uniform (sampler2D, implicit) | The previous stage's rendered output — the tile's own frame for slot 1, or the prior effect's output for slots 2/3 |
| `fxSample(uv)` | helper function | Samples `u_fxSource` at the given UV — this is how an effect reads "the image so far" |
| `u_fxMix` | uniform (float) | Wet/dry blend applied by the wrapper *after* `fxMain` runs — lets any effect be partially blended back with its input without the shader itself needing a mix parameter |
| `u_time` | uniform (float) | Shared animation clock, same source every renderer uses |
| `u_resolution` | uniform (vec2) | Current render target size in pixels |
| `u_echoBuffer` / `fxEcho(uv)` | uniform + helper | Only present for effects with `usesEcho: true` in the manifest — see §5 |

Every shader file in this rack opens with a comment restating this contract explicitly (a deliberate documentation convention, not incidental) — e.g. from `crt.frag`:

> *"Contract: declare `fxMain(vec2 uv) -> vec4` plus this effect's own uniforms (bound via `Control.binding` in `effects/manifest.json`). `u_fxSource`/`u_fxMix`/`u_time`/`u_resolution` and the final mix blend are supplied by the wrapper in `lib/gl/effects-compositor.ts`."*

### What each effect file declares itself

Only its **own** parameter uniforms — plain `float`/`bool`/`vec3` uniforms named to match the `binding.name` field in its manifest entry (e.g. `u_curvature`, `u_grainIntensity`, `u_flashColor`). These are bound automatically by the compositor from the tile's current `effectsState` param values every frame — the same `Control.binding` → uniform-binding mechanism the main renderer contract already uses for `@`-tag-annotated shader uniforms (`renderers/control-schema.ts`, `lib/gl/parse-uniforms.ts`), reused here rather than reinvented.

---

## 4. The manifest — how an effect becomes a UI control

`effects/manifest.json` is the single source of truth for every effect's identity, grouping, and parameter set. One entry:

```json
{
  "id": "crt",
  "title": "CRT",
  "family": "texture",
  "file": "crt.frag",
  "hint": "Barrel curvature, scanlines, RGB subpixel mask, and edge vignette...",
  "params": [
    {
      "id": "curvature",
      "kind": "slider",
      "label": "Curvature",
      "default": 0.15, "min": 0, "max": 0.5, "step": 0.01,
      "modulatable": true,
      "binding": { "target": "uniform", "name": "u_curvature", "glslType": "float" }
    }
    /* …scanlines, density, vignette, mask */
  ],
  "accentColor": "#5CFF7A"
}
```

- **`id`** — stable identifier, used in `Asset.effectsState` and as the manifest lookup key.
- **`family`** — groups effects in `VfxPanel.tsx`'s picker UI (see §6).
- **`file`** — the `.frag` file in `effects/shaders/`. Multiple manifest entries can point at the **same file** (White Strobe → `dark-strobe.frag`) when the only difference is a fixed constant, not shader logic — see §7.1.
- **`params`** — an array of `Control`-shaped param definitions (same `ControlKind` vocabulary as the main renderer contract: `slider`, `select`, `toggle`, `color`). Each carries a `binding` describing exactly which GLSL uniform it drives.
- **`modulatable`** — whether the param can be wired into `lib/modulation/` as a target, same mechanism as any other tile parameter.
- **`usesEcho`** (optional, boolean) — opts the effect into the echo/feedback buffer; see §5.
- **`accentColor`** — per-effect UI accent used in `VfxPanel.tsx`'s family-grouped picker.

This is a **data-driven registry**, not a switch statement — adding an effect is (1) drop a `.frag` file that implements `fxMain`, (2) add one manifest entry describing its params. No compositor code changes required for the common case. The one exception historically was `usesEcho` before it existed as a flag (§5) and the `select`-kind uniform-binding gap fixed for Math Warp (§7.5) — both now handled generically.

---

## 5. The echo / feedback buffer mechanism

Two effects — **Dark Strobe** (`echo` param, optional) and **Turbulent Feedback** (load-bearing, not optional) — read from a **persistent trail buffer** via `fxEcho(uv)`, distinct from `fxSample(uv)` which reads the current frame.

- The compositor maintains an `echoCanvases` buffer per tile slot that accumulates recent frames.
- Access is gated by `EffectDefinition.usesEcho: true` in the manifest/type registry — this used to be a hardcoded `if (effect.id === 'dark-strobe')` string check in `effects-compositor.ts`; it was generalized to a data-driven flag during the Phase 4.96 diagnostic pass specifically so any future effect can opt in without touching compositor code.
- **Dark Strobe** treats echo as optional color: `u_echoAmount` defaults to 0 (off, zero extra cost), and when enabled, the trail ghosts through the strobe's dark gaps (`mix(strobed, max(strobed, echo.rgb), u_echoAmount * (1.0 - lit))`) — visible specifically during the "off" portion of the strobe cycle, which is the entire point of pairing strobe with a trail.
- **Turbulent Feedback** is the buffer's second consumer and uses it as its core mechanism, not a bonus: it resamples the trail through a turbulent-noise-warped UV offset before blending it back over the live frame (`fxEcho(uv + warp)`), so the accumulated trail itself churns and folds frame-to-frame rather than just fading like a plain ghost trail.

---

## 6. Effect families (`EffectFamily`)

Effects are grouped in the UI picker (`VfxPanel.tsx`'s `FAMILY_ORDER`) by family:

| Family | Effects | Character |
|---|---|---|
| `strobe` | Dark Strobe, White Strobe | Temporal on/off flicker — the only family that's fundamentally time-driven rather than a pure spatial UV remap |
| `mirror` | Linear Mirror, Quad Mirror, Invert | Pure UV-domain reflection/folding — no noise, no time dependence beyond what's already in the source |
| `warp` | Math Warp, Noise Displacement | Continuous UV distortion — Math Warp via closed-form parametric transforms, Noise Displacement via a drifting value-noise field |
| `color` | Hue Shift LUT | Post-hoc color grading (HSV rotation), doesn't touch UV sampling at all |
| `texture` | Grain, CRT, BrokeTV | Adds a stateless per-pixel texture/pattern layer over the source |
| `slice` | Graphic Slice | Discrete, stepped-clock band displacement — glitch-cut character, distinct from the continuous `warp` family |
| `feedback` | Turbulent Feedback | Persistent-buffer-driven — the only family that reads `fxEcho` as its core mechanism rather than an optional add-on |

`texture` and `feedback` were added as new `EffectFamily` values during the Phase 4.96 expansion; `slice` existed as a reserved-but-empty family from the original catalog scoping until Graphic Slice filled it.

---

## 7. The 13 effects, in detail

Each entry below covers: what it does, its exposed controls, and the actual GLSL mechanism.

### 7.1 Dark Strobe / White Strobe — *family: `strobe`*

**File:** `dark-strobe.frag` (shared by both manifest entries)
**Params:** Rate (0.5–30 Hz), Duty cycle (0.05–0.95), Edge hardness (0–1), Echo (0–1, **Dark Strobe only**) · White Strobe additionally carries a fixed, non-user-facing `flashColor` constant (white) instead of Echo.

**Mechanism:** `phase = fract(u_time * u_strobeRate)` produces a repeating 0→1 ramp at the chosen rate. `onWidth = 1 - duty` sets how much of each cycle is "lit." A `smoothstep` around that boundary (`edge`, shrinking toward a hard cut as Hardness → 1) produces `lit`, a 0–1 crossfade value. The final color is `mix(u_flashColor, src.rgb, lit)` — i.e. it crossfades between the source frame and a flat flash color (black for Dark Strobe, white for White Strobe) at the chosen rate/duty/hardness.

Two manifest entries intentionally point at one file: verified algebraically that with `u_flashColor = (0,0,0)`, `mix(flashColor, src.rgb, lit)` reduces to exactly `src.rgb * lit` — Dark Strobe's behavior is unchanged from before White Strobe was added. Echo is gated off for White Strobe at the manifest level (the `echo` param is simply absent from that entry, so `u_echoAmount` stays at its GL default of 0) because `max(strobed, echo.rgb)` blend math doesn't read correctly against a white flash — flagged as a known follow-up rather than shipped incorrect.

**`edge = mix(0.2, 0.002, hardness)`** — clamped away from exactly 0 because `smoothstep(edge0, edge1, x)` is undefined when `edge0 == edge1`.

---

### 7.2 Linear Mirror — *family: `mirror`*

**File:** `linear-mirror.frag`
**Params:** Angle (0–360°), Offset (−0.5–0.5)

**Mechanism:** Folds the frame across an arbitrary line rather than a fixed horizontal/vertical choice. Computes the line's direction vector from `Angle`, derives its perpendicular `normal`, then measures each pixel's signed distance from the (offset) line: `d = dot(uv - 0.5, normal) - offset`. Anything on the far side (`d > 0`) gets reflected back across the line (`centered -= 2*d*normal`); the near side is untouched. Two continuous sliders cover strictly more ground than a 3-way H/V/both selector would.

---

### 7.3 Quad Mirror — *family: `mirror`*

**File:** `quad-mirror.frag`
**Params:** Center X, Center Y (0–1 each)

**Mechanism:** Classic 4-way kaleidoscope fold. `folded = center + abs(uv - center)` collapses all four quadrants' offsets from the adjustable center into one positive-positive quadrant. Because the center is a continuous, modulatable parameter rather than fixed to the frame's exact middle, an LFO nudging it makes the whole mirrored pattern breathe instead of sitting static.

---

### 7.4 Invert — *family: `mirror`*

**File:** `invert.frag`
**Params:** Center X, Center Y (0–1 each)

**Mechanism:** Point reflection (180° rotation) through an adjustable center: `inverted = 2*center - uv`. Completes the Linear/Quad/Invert mirror-family trio from the original brainstorm.

---

### 7.5 Math Warp — *family: `warp`*

**File:** `math-warp.frag`
**Params:** Formula (select: Quadratic / Swirl), Amount (0–1), Scale (0.2–4)

**Mechanism:** A single mode-select uber-shader rather than one file per formula, so new formulas can be added later without growing the effect list in the UI. `centered = (uv - 0.5) * scale` brings the frame into the transform's natural input range.

- **Quadratic** (`mode 0`): the reference transform the whole effect was scoped around, `T(x,y) = (x+y, x²−y²)`.
- **Swirl** (`mode 1`): `angle = atan(c.y, c.x) + (1 - clamp(radius,0,1)) * 2π` — more twist near the center, tapering to none at the edge of the zoomed field, reading as a vortex rather than uniform rotation.

`Amount` blends between the untouched and fully-warped sample position (`mix(centered, warped, amount)`) before mapping back to UV space.

**Notable fix (Phase 4.96 diagnostic pass):** the Formula/Swirl mode was originally unreachable in the shipped build — `select`-kind control values are strings (`"0"`/`"1"`), but the compositor's uniform-binding path only forwarded `number`/`boolean`/`array` types to the shader. Fixed in `effects-compositor.ts`, mirroring the same string→uniform coercion pattern `shader.renderer.ts` already used for the main render path's own `select` controls.

---

### 7.6 Hue Shift LUT — *family: `color`*

**File:** `hue-shift.frag`
**Params:** Hue (0–360°), Saturation (0–2×), Brightness (0–2×)

**Mechanism:** Standard RGB↔HSV round-trip (`rgb2hsv`/`hsv2rgb`, the well-known shader-toy formulation, no external dependency). Hue is rotated by `fract(hsv.x + hue/360)`, saturation and brightness are simple multipliers, clamped to valid ranges.

**Scoping note (documented in-file):** despite the "LUT" in its title, this is an HSV rotation pass, not a texture-based 3D color LUT. A true texture-LUT implementation was explicitly named as separate, larger future work if still wanted; this ships the simpler, immediately useful version now.

---

### 7.7 Grain — *family: `texture`*

**File:** `grain.frag`
**Params:** Intensity (0–1), Grain size (1–8 px), Colored grain (toggle)

**Mechanism:** Per-pixel additive noise. `px = floor(uv * resolution / grainSize)` buckets pixels into grain cells; a hash of `(px + seed)` (seed = `u_time * 59`) produces per-cell noise, added to the source color and clamped. `Colored grain` off uses one monochrome hash; on, three independent hashes (offset by 11/37/71) per channel for a punchier, per-channel-noisy look. Fully stateless — no feedback buffer, cheapest effect in the rack computationally.

**Bugfix (post-ship field testing) — precision-collapse hash:** the original hash (`p = fract(p*vec2(123.34,456.21)); p += dot(p,p+45.32); return fract(p.x*p.y)`) is safe for normalized UV-scale inputs but was being fed **raw pixel-cell coordinates** here — values in the thousands. `p.x*p.y` at that magnitude lands in the hundreds-of-thousands-to-millions range; float32 has ~7 decimal digits of precision, so `fract()` of a number that large returns a heavily quantized, non-random result — confirmed by simulating the exact math at real canvas resolutions, reproducing the "thin vertical bands instead of noise" artifact pixel-for-pixel. That coherent periodic structure is also what was aliasing against a tile's own motion and reading as reversed drift (a real periodic-signal beat pattern, not a direction bug). **Fixed** with a precision-safe hash idiom that multiplies by a small constant and `fract()`s immediately, before any operation that could blow up precision:

```glsl
float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.13);
  p3 += dot(p3, p3.yzx + 3.333);
  return fract((p3.x + p3.y) * p3.z);
}
```

This is now a **standing project principle** (recorded in project memory): any future GPU noise work in this codebase should use this hash idiom, not the amplify-then-fract pattern, whenever pixel-scale (non-normalized) coordinates are involved. The same fix was applied proactively to Noise Displacement and Turbulent Feedback (§7.9, §7.11) even though their inputs weren't yet large enough to have triggered the bug — pre-empting the same failure as `u_time` grows over a long session.

**BrokeTV (§7.13) is a direct spin-off of this bug** — see that entry.

---

### 7.8 CRT — *family: `texture`*

**File:** `crt.frag`
**Params:** Curvature (0–0.5), Scanlines (0–1), Density (1.5–8), Vignette (0–1), RGB mask (0–1)

**Mechanism:** Four independent effects layered together in one pass:

1. **Barrel distortion** — `barrel(uv, amount)` offsets `uv` from center by `1 + amount * r²` (r = distance from center), the standard lens-curvature warp. If the warped sample falls outside `[0,1]` on either axis, the shader falls back to the **flat, undistorted** source rather than a hard black border — curvature reads as a lens over the tile rather than a crop.
2. **Scanlines** — `sin(yPx * 2π / period)` where `period = u_scanlineDensity` (source pixels per scanline pair), mixed against flat white by `Scanlines` intensity.
3. **RGB subpixel mask** — `mod(warped * resolution, 3.0)` buckets each pixel into one of three columns, tinting each toward red/green/blue respectively to fake a phosphor triad, mixed in by `RGB mask` strength.
4. **Vignette** — radial `smoothstep` darkening from `dist = length(warped - 0.5)`, ramped in by `Vignette`.

**Bugfix (post-ship field testing) — scanline aliasing:** the original formula hardcoded the scanline period to exactly 2 source pixels (`sin(y * resolution.y * π)`) — the absolute Nyquist limit for the render resolution (brightness alternating every single pixel row). Any pattern at that frequency is guaranteed to alias against vertical motion in the underlying tile, which visually read as the tile's own drift reversing direction (the same category of artifact real interlaced/scanned CRTs exhibit against moving content — not a bug reversing anything, a genuine aliasing beat). **Fixed** by exposing the line period as the new `Density` control (default 3px, tunable 1.5–8px) instead of hardcoding it to native resolution — this reduces, but doesn't fully eliminate, aliasing at very fast tile motion; raising Density further trades scanline crispness for less beating.

---

### 7.9 Noise Displacement — *family: `warp`*

**File:** `noise-displace.frag`
**Params:** Amount (0–0.5), Scale (0.5–8), Speed (0–2)

**Mechanism:** Samples the source at a UV offset by a smooth, animated 2D value-noise field, distinct from Math Warp's closed-form transforms. `field = uv*scale + time*speed`; two independent `valueNoise()` samples (offset from each other) drive the x/y displacement components, scaled by `Amount` and added to `uv` before sampling. `valueNoise` is a standard bilinear-interpolated (smoothstep-eased) hash-grid noise — the classic "value noise" (not Perlin gradient noise) construction. Deliberately does not share code with Math Warp — each effect file is self-contained per the registry's own contract, so this carries its own hash/noise pair rather than importing one.

Uses the same precision-safe hash as Grain (applied proactively, not reactively — see §7.7).

---

### 7.10 Graphic Slice — *family: `slice`*

**File:** `slice.frag` · **manifest id:** `graphic-slice`
**Params:** Bands (2–64), Amount (0–0.3), Rate (0.5–30 Hz)

**Mechanism:** Row-banded horizontal displacement glitch. The frame is divided into `Bands` horizontal strips (`band = floor(uv.y * bandCount)`); each band gets its own per-cycle random horizontal offset. Unlike Noise Displacement's continuously-drifting field, this **re-randomizes on a stepped clock**: `stepIndex = floor(time * rate)` changes in discrete jumps, so each band's offset holds steady then snaps to a new value `Rate` times per second — reading as discrete glitch cuts rather than a smooth wobble. Uses the simple 1D hash `fract(sin(n) * 43758.5453)` (safe here since inputs stay small — band index × constant + step index × constant, never raw pixel coordinates).

Fills the `slice` `EffectFamily`, which had been reserved-but-empty in `VfxPanel.tsx`'s family ordering since the original catalog scoping.

---

### 7.11 Turbulent Feedback — *family: `feedback`*

**File:** `turbulent-feedback.frag`
**Params:** Turbulence (0–1), Decay (0–1), Scale (0.5–8)

**Mechanism:** The one effect in the rack for which the echo/trail buffer (§5) is load-bearing rather than optional. Each frame, the accumulated trail (`fxEcho`) is read not at the plain current UV but at a **turbulence-warped** UV: a value-noise field (`field = uv*scale + time*0.15`) produces a small 2D offset, scaled by `Turbulence`, applied to the trail-buffer sample coordinate before reading it. The warped trail is then blended back over the live source frame by `Decay`: `mix(src.rgb, max(src.rgb, trail.rgb), decay)`. The result is a feedback loop where the ghost trail itself continuously churns and folds rather than simply fading in place — a "turbulent" trail, not a static ghost.

Uses the same precision-safe hash/value-noise pair as Noise Displacement (independently duplicated per the self-contained-file convention, not imported).

---

### 7.12 BrokeTV — *family: `texture`*

**File:** `broke-tv.frag`
**Params:** Intensity (0–1), Band width (1–8 px), Roll speed (0–200 px/sec, default 0)

**Origin:** Not originally planned — this is Grain's precision-collapse bug (§7.7), before it was fixed, preserved on request as its own deliberate effect because the resulting look (coherent vertical color-bar banding, like a mistracking analog TV signal) was distinctive and aesthetically worth keeping. **Rebuilt clean, not copy-pasted from the broken version**, with two structural differences that specifically avoid reproducing the original bug's side effects:

- Uses the **safe 1D hash** (`fract(sin(n) * 43758.5453)`, same one `slice.frag` uses) instead of the unsafe 2D hash that caused the original problem.
- Bands are a function of **x only** — never y, and never a value baked identically into both axes the way the original bug's coupled `seed` was — so there's no structural path back to that failure mode.

**Mechanism:** `x = uv.x * resolution.x + time * rollSpeed`; `col = floor(x / bandWidth)` buckets columns into vertical bands; each band's hash produces a per-band brightness/tint value, mixed with white by `Intensity` and multiplied against the source color. `Roll speed` defaults to **0** — fully static — which is what actually resolves the "reverses the tile's own drift direction" complaint that motivated Grain's original fix: a static pattern has no motion of its own to beat against a tile's real animation, structurally, not just by convention. Dialing Roll speed above 0 is an intentional, opt-in horizontal drift.

---

## 8. Cross-cutting technical findings (apply to future effect work)

These are standing, reusable lessons surfaced during the Phase 4.96 build/diagnostic pass — not specific to any one effect, and relevant to any new shader added to this rack (or the main renderer contract) going forward.

1. **Precision-safe hashing is mandatory for any pixel-scale noise input.** `hash(vec2)` idioms that amplify their input before `fract()`-ing (`p*vec2(123,456)` style) silently collapse into coherent banding once fed raw pixel coordinates (values in the thousands) — float32 only carries ~7 decimal digits. Use the multiply-by-small-constant-then-fract-immediately idiom (`fract(vec3(p.xyx) * 0.13)` then further mixing) shown in Grain/Noise Displacement/Turbulent Feedback instead. This is filed as a standing project principle, not a one-off patch.

2. **Any strictly periodic screen-space pattern (scanlines, fixed-frequency stripes) risks aliasing against a moving tile's own motion**, and that aliasing is easily misread as "the effect is reversing my tile's drift direction" — it isn't; it's a beat-frequency artifact between two periodic signals. The fix is always the same shape: make the pattern's spatial frequency a tunable control (CRT's `Density`) rather than hardcoding it to native resolution, or default the pattern to fully static so it has no competing motion of its own (BrokeTV's `Roll speed = 0` default).

3. **`select`-kind control values are strings, and any uniform-binding path must explicitly coerce them** — the Math Warp bug (§7.5) was exactly this gap. Any future effect with a `select`-kind param should be tested end-to-end through the compositor's binding path, not just visually inspected in isolation.

4. **`usesEcho` is a data-driven manifest/type flag, not a per-effect string check.** Any new effect wanting access to the persistent trail buffer opts in via `EffectDefinition.usesEcho: true` — no compositor code change required.

5. **Effect files are deliberately self-contained.** Shared math (hash functions, value-noise) is duplicated per-file rather than imported from a shared module, by explicit convention (stated directly in multiple shaders' own doc comments) — keeps each effect a single, complete, independently-reasoned-about unit at the cost of some duplication. Don't "clean this up" by extracting a shared noise library without deliberately revisiting that convention first.

---

## 9. Adding a new effect — playbook

1. **Write the `.frag` file** in `effects/shaders/`, implementing `fxMain(vec2 uv) -> vec4` only. Declare only the effect's own param uniforms — never `u_fxSource`, `u_fxMix`, `u_time`, `u_resolution`, or echo symbols; those come from the wrapper.
2. **If the effect needs pixel-scale noise**, use the precision-safe hash idiom (§8.1) from the start — don't wait for a field bug to surface it.
3. **If the effect has any spatially-periodic pattern** (stripes, scanlines, repeating cells) at a frequency close to native resolution, expose the period/density as a tunable control rather than hardcoding it (§8.2).
4. **Add one manifest entry** in `effects/manifest.json`: `id`, `title`, `family` (reuse an existing family where it genuinely fits; only add a new one if the effect's character doesn't match any existing group), `file`, `hint`, `params[]` with correct `binding.name` matching the shader's uniform names exactly, and `accentColor`.
5. **Set `usesEcho: true`** only if the effect reads `fxEcho()` — omit entirely otherwise (no cost when unused).
6. **Verify `select`-kind params (if any) round-trip correctly** through the compositor's binding path end-to-end, not just that the manifest parses — this is the exact class of bug Math Warp shipped with initially.
7. Run the project's shader verification pass (mirrors `verify-seed.ts`'s role for the main renderer contract) before considering the effect shippable.

---

## 10. Quick-reference table

| Effect | Family | File | Params | Uses Echo |
|---|---|---|---|---|
| Dark Strobe | strobe | `dark-strobe.frag` | Rate, Duty cycle, Edge hardness, Echo | Yes (optional) |
| White Strobe | strobe | `dark-strobe.frag` | Rate, Duty cycle, Edge hardness, (fixed white flash) | No |
| Linear Mirror | mirror | `linear-mirror.frag` | Angle, Offset | No |
| Quad Mirror | mirror | `quad-mirror.frag` | Center X, Center Y | No |
| Invert | mirror | `invert.frag` | Center X, Center Y | No |
| Math Warp | warp | `math-warp.frag` | Formula (select), Amount, Scale | No |
| Hue Shift LUT | color | `hue-shift.frag` | Hue, Saturation, Brightness | No |
| Grain | texture | `grain.frag` | Intensity, Grain size, Colored grain | No |
| CRT | texture | `crt.frag` | Curvature, Scanlines, Density, Vignette, RGB mask | No |
| Noise Displacement | warp | `noise-displace.frag` | Amount, Scale, Speed | No |
| Graphic Slice | slice | `slice.frag` | Bands, Amount, Rate | No |
| Turbulent Feedback | feedback | `turbulent-feedback.frag` | Turbulence, Decay, Scale | Yes (load-bearing) |
| BrokeTV | texture | `broke-tv.frag` | Intensity, Band width, Roll speed | No |

**Total: 13 manifest entries / 12 shader files / 7 families.**

---

*Compiled directly from `effects/manifest.json` and `effects/shaders/*.frag` as provided. Compositor-internals (`lib/gl/effects-compositor.ts`, `VfxPanel.tsx`, `lib/effects/registry.ts`) are described here based on the behavior documented in shader source comments and `IMPLEMENTATION_PLAN_AUG_22.md` §7 Phase 4.96 — those files themselves weren't in the reviewed source set. If you want this doc cross-checked line-by-line against the actual compositor/registry/panel source, share those files and I'll reconcile any drift.*
