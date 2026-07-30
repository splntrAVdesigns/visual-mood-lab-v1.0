# Visual Mood Lab — Implementation Plan

**Status:** Phase 0 complete → Phase 1
**Last updated:** 2026-07-27 (rev 3 — Phase 0 shipped; §9 budget corrected against measurement)

---

## 1. What this is

A web-based visual mood board for creative-coding and graphics work. It holds five kinds of asset in one board and lets each one be inspected, tuned, and composed:

| Type | Format | Runtime |
|---|---|---|
| Graphics | SVG | DOM / inline |
| Vector animation | WebM | `<video>` |
| Visual art | PNG / JPG / WebP / MP4 | `<img>` / `<video>` |
| Creative code | p5.js sketch (JS source) | sandboxed iframe |
| Shaders | GLSL fragment source | WebGL2 |

The product is not a gallery. A gallery shows you things; this lets you **change** them — every asset exposes parameters, every parameter is savable, and a saved parameter set is itself a board item.

### Non-goals for v1

Deliberately out of scope, so the surface stays finishable:

- Multi-user real-time collaboration
- Video editing / timeline sequencing (revisit at Phase 6)
- Mobile-native app
- Public gallery, comments, social features
- Arbitrary npm imports inside user sketches

---

## 2. Stack

| Layer | Choice | Why |
|---|---|---|
| Framework | Next.js 16, App Router | Colocation, route groups, first-class Vercel deploy |
| UI | React 19 + TypeScript (strict) | Matches existing project conventions |
| State | Zustand (sliced) | Already proven on the shader-studio work; no provider tree |
| Styling | CSS Modules + design tokens | Predictable specificity; no utility-class soup around canvas code |
| Graphics | Raw WebGL2 | Full control over context lifetime and uniform binding |
| Sketch runtime | p5.js 1.x in a sandboxed iframe | Isolation is non-negotiable |
| Editor | CodeMirror 6 | Smaller and better on touch than Monaco |
| DB | Postgres (Neon) + Drizzle | Typed queries, cheap branching for previews |
| Blobs | Vercel Blob or Cloudflare R2 | Client-direct upload via signed URLs |
| Auth | Auth.js | Single provider (GitHub) is enough for v1 |

**Explicitly rejected:** React Native (no DOM, no WebGL2 story, doesn't deploy to Vercel). If mobile matters later, this becomes a PWA.

---

## 3. Architecture principles

Five rules. When a decision is unclear, resolve it against these in order.

1. **The renderer contract is the product.** Every asset type implements the same `AssetRenderer` interface. Anything that special-cases a type outside `renderers/` is a bug.
2. **The UI is generated, never authored per type.** The inspector drawer maps over a `ControlSchema`. Adding an asset type costs one adapter file and zero UI changes.
3. **Live rendering is a scarce resource.** Cards are static until promoted. The renderer pool is bounded. The GPU budget is a hard constraint, not an optimisation pass.
4. **User code never touches the main thread.** Sketches run in a sandboxed iframe behind a `postMessage` protocol, with a watchdog.
5. **`components/ui/` is dumb.** The moment a shared component knows what a shader is, it moves into `features/`.

---

## 4. Directory structure

```
visual-mood-lab/
├─ app/
│  ├─ layout.tsx                    # shell: header + side drawer
│  ├─ page.tsx                      # board overview
│  ├─ (board)/
│  │  ├─ board/[boardId]/page.tsx
│  │  └─ asset/[assetId]/page.tsx   # deep-linkable focused view
│  ├─ (lab)/
│  │  └─ playground/page.tsx        # mini p5 / shader editor
│  ├─ api/
│  │  ├─ assets/route.ts
│  │  ├─ upload/route.ts            # signed URL issuance only
│  │  └─ thumbnail/route.ts
│  └─ globals.css
├─ features/
│  ├─ board/                        # grid, card, layout, filters, selection
│  ├─ inspector/                    # right drawer + schema-driven controls
│  │  └─ controls/                  # one component per ControlKind
│  ├─ navigation/                   # header, side drawer, command palette
│  ├─ playground/                   # editor, sandbox host, console, presets
│  └─ library/                      # upload, tagging, collections
├─ renderers/
│  ├─ control-schema.ts             # ← the contract
│  ├─ registry.ts                   # type → adapter map
│  ├─ base.renderer.ts              # shared playback/transform handling
│  ├─ image.renderer.ts
│  ├─ svg.renderer.ts
│  ├─ video.renderer.ts
│  ├─ p5.renderer.ts
│  └─ shader.renderer.ts
├─ lib/
│  ├─ gl/
│  │  ├─ parse-uniforms.ts          # ← GLSL → ControlSchema
│  │  ├─ context-pool.ts
│  │  ├─ program-cache.ts
│  │  └─ fbo.ts
│  ├─ sandbox/                      # iframe bridge, message protocol, watchdog
│  ├─ modulation/                   # param bus: time, audio FFT, LFO, MIDI
│  ├─ storage/
│  └─ db/
├─ stores/                          # board, playback, inspector, theme, mod
├─ components/ui/                   # primitives: button, slider, drawer, dialog
└─ styles/tokens.css
```

**Rule of thumb:** if two features need it and it has no domain knowledge → `components/ui/`. If it has domain knowledge → the feature that owns it, exported from the feature's `index.ts`.

---

## 5. The renderer contract

```ts
interface AssetRenderer {
  readonly type: AssetType;
  mount(el: HTMLElement, asset: Asset, signal: AbortSignal): Promise<void>;
  play(): void;
  pause(): void;
  seek?(t: number): void;
  getControlSchema(): ControlSchema;
  setParam(id: string, value: ParamValue): void;
  setQuality(q: 'preview' | 'full'): void;
  capture(opts: CaptureOpts): Promise<Blob>;
  dispose(): void;
}
```

`getControlSchema()` is the pivot. For shaders it is produced by `parseUniforms()` at ingest. For p5 sketches it comes from an exported `params` object in the sketch source. For images/SVG/video it is `BASE_CONTROLS` plus a handful of type-specific extras.

Ships with `control-schema.ts` and `parse-uniforms.ts` (already written and tested — 37 assertions, strict typecheck clean).

---

## 6. Data model

```ts
type AssetType = 'image' | 'svg' | 'video' | 'p5' | 'shader';

type Asset = {
  id: string;
  ownerId: string;
  type: AssetType;
  title: string;
  tags: string[];

  srcUrl?: string;        // blob URL, for binary assets
  source?: string;        // code text, for p5 / shader assets
  posterUrl: string;      // generated at ingest, always present

  schema: ControlSchema;  // cached parse result
  params: ParamState;     // saved control values
  mod: ModState;          // saved modulation routing

  dominantColors: string[];
  width: number;
  height: number;
  durationMs?: number;

  createdAt: Date;
  updatedAt: Date;
};

type BoardItem = {
  id: string;
  boardId: string;
  assetId: string;
  order: number;
  x?: number; y?: number; w?: number; h?: number;  // canvas mode
  paramsOverride?: ParamState;   // snapshots: same asset, different look
};
```

**`paramsOverride` is the highest-leverage field in the schema.** It turns twelve shaders into sixty distinct board items at zero storage cost.

Store code assets as **text in Postgres**, not blobs. They become searchable, diffable, and versionable for free.

---

## 7. Phases

Each phase has a shippable outcome and an explicit exit criterion. Do not start the next until the exit criterion is met.

### Phase 0 — Shell ✅ COMPLETE

- [x] `create-next-app`, TypeScript strict, CSS Modules, path aliases
- [x] `styles/tokens.css` with the full palette + type scale
- [x] `app/layout.tsx`: header, left drawer, main region, right drawer slot
- [x] `components/ui/`: Button, IconButton, Slider, Toggle, Select, Drawer, Dialog, Tooltip
- [x] Zustand slices scaffolded: `boardStore`, `inspectorStore`, `playbackStore`
- [x] `seed/` directory + authoring conventions locked (see §8)
- [x] Reference implementations: `gradient-grid.frag` and `particle-burst.js`
- [x] Deployed to Vercel with preview branches

**Verified:** `tsc --noEmit` strict clean · `next build` 3/3 static pages · `verify:seed` passing (15 controls from gradient-grid, 12 from particle-burst) · 20 cards server-rendered on the production build.

**Exit:** the shell opens and closes both drawers, is keyboard-navigable, and renders a grid of placeholder cards responsively down to 375px. Both reference seed assets parse into valid schemas.

### Phase 1 — Library (est. 1 week)

- [ ] Drizzle schema + Neon, migrations
- [ ] Signed-URL upload flow; client uploads direct to blob storage
- [ ] Server-side poster generation (`sharp` for images/SVG, `ffmpeg` frame grab for video)
- [ ] Dominant-colour extraction at ingest
- [ ] `image` / `svg` / `video` renderers
- [ ] Grid with tags, type filter, and search
- [ ] Auth.js with GitHub
- [ ] Author the remaining 18 seed assets (§8)
- [ ] `scripts/seed.ts` — loads `seed/` through the normal ingest pipeline

**Exit:** run the seed script on an empty database and get 20 correctly-postered, correctly-tagged assets in the grid. Upload 10 more by hand and see no difference in how they behave.

### Phase 2 — Live rendering (est. 1.5 weeks)

- [ ] `lib/gl/context-pool.ts` — shared WebGL2 context, FBO render targets, blit to card canvases
- [ ] `shader.renderer.ts` + program cache + compile error surfacing
- [ ] `lib/sandbox/` — iframe host, message protocol, watchdog, error overlay
- [ ] `p5.renderer.ts` running library sketches through the sandbox
- [ ] Renderer pool with LRU eviction, max 4–6 live
- [ ] `IntersectionObserver` promotion: `poster → preview → focused`
- [ ] Global pause; `prefers-reduced-motion` honoured

**Exit:** a board containing the full 20-asset seed library plus 20 uploaded media assets scrolls at 60fps on a mid-range laptop, holds under 400MB, and shows no context-loss warnings. Real shaders, not placeholders — this is the first phase where the seed set earns its keep.

### Phase 3 — The inspector (est. 1 week) ← *this is where it becomes the product*

- [ ] `parseUniforms()` wired into shader ingest; schema cached on the asset row
- [ ] One component per `ControlKind` in `features/inspector/controls/`
- [ ] Grouped, ordered rendering with the Advanced disclosure
- [ ] `showIf` conditional visibility
- [ ] Debounced param persistence (250ms) with optimistic local state
- [ ] `hydrate()` on load so schema changes never break saved params
- [ ] Param snapshots → `BoardItem.paramsOverride`
- [ ] Deep-linkable focused view at `/asset/[id]`
- [ ] Seed set verified as inspector fixtures — every control kind rendered and persisted

**Exit:** open any of the 20 seed assets, adjust every control, reload the page, and get the identical frame back. All ten `ControlKind` values are exercised by the seed set, so this doubles as full inspector coverage.

### Phase 4 — Modulation bus (est. 4–5 days)

- [ ] `lib/modulation/` — shared clock, Web Audio analyser, LFO bank
- [ ] Right-click a modulatable control → assign a source, set amount and rate
- [ ] Visual indicator on modulated controls
- [ ] One audio input shared across all live renderers

**Exit:** three different assets on one board react to the same audio source simultaneously with no added frame cost.

### Phase 5 — Playground (est. 1.5 weeks)

- [ ] CodeMirror 6 with GLSL and JavaScript modes
- [ ] Debounced hot-reload (~400ms) with an inline error overlay
- [ ] Live-parsed uniform annotations → controls appear as you type
- [ ] Starter templates: p5 sketch, fragment shader, feedback shader
- [ ] Save sketch → becomes a library asset
- [ ] Fork an existing asset into the editor

**Exit:** write a shader from scratch in the browser, annotate a uniform, see the control appear, save it to the board, and reopen it as a normal asset.

### Phase 6 — Export & polish (est. 1 week)

- [ ] PNG capture at 1×/2×/4×
- [ ] WebM capture via `MediaRecorder`; offline frame-exact export via `webm-writer`
- [ ] Command palette (`cmdk`)
- [ ] Board sharing via read-only link
- [ ] Empty states, loading skeletons, error boundaries per route
- [ ] Lighthouse pass; bundle audit

**Exit:** export a 10-second 1080p WebM of a modulated shader without dropping frames.

---

## 8. Seed library

Twenty hand-authored assets ship with the repo: 10 GLSL shaders and 10 p5.js sketches. Image and video assets are uploaded manually by the owner.

### Why this is not a Phase 6 nice-to-have

The seed library is the **test corpus that makes Phases 2 and 3 verifiable.** Placeholder cards cannot fail a performance budget — real shaders can. A schema-driven inspector that has only ever been tested against one hand-written schema is untested. Authoring these early is cheaper than authoring them late, and it front-loads the discovery of every gap in the renderer contract.

The payoff is still deferred to Phase 3 — the assets are inert text files until then — but the authoring is not.

### Where they live

```
seed/
├─ shaders/
│  ├─ gradient-grid.frag
│  ├─ ascii-mosaic.frag
│  └─ …
├─ sketches/
│  ├─ particle-burst.js
│  └─ …
└─ manifest.json          # title, tags, poster hints, default params
```

Loaded by `scripts/seed.ts` **through the same ingest pipeline as user uploads** — no special path. If seeding works, upload works.

### Authoring conventions

**Shaders** — WebGL2 fragment shaders (`#version 300 es`), annotated per `parse-uniforms.ts`. Host-driven uniforms come from `DEFAULT_RESERVED`; everything else becomes a control.

**Sketches** — p5.js instance mode, exporting a `params` object read by the sandbox at boot and posted back as a schema:

```js
export const params = {
  count:   { kind: 'slider', label: 'Particles', min: 50, max: 4000, step: 1, default: 1200, modulatable: true },
  gravity: { kind: 'slider', label: 'Gravity',   min: -1, max: 1, default: 0.12 },
  tint:    { kind: 'color',  label: 'Tint',      default: { r: 0, g: 0.83, b: 1, a: 1 } },
  trails:  { kind: 'toggle', label: 'Trails',    default: true },
};

export default function sketch(p, get) {
  p.setup = () => { /* … */ };
  p.draw  = () => { const n = get('count'); /* … */ };
}
```

A plain JS object, not a comment DSL — it is real code, type-checkable against `Control`, and requires no second parser to write and test.

### Shader set

| # | Slug | Concept | Control kinds exercised |
|---|---|---|---|
| 1 | `gradient-grid` | Cell-based colour gradients, adjustable grid | slider, color, xy, select |
| 2 | `ascii-mosaic` | Luminance → procedural bitmap glyphs | slider, texture, toggle, color |
| 3 | `ordered-dither` | Bayer 4×4/8×8 with palette quantisation | select, stepper, color, toggle |
| 4 | `halftone-screen` | Rotated CMYK dot screens | slider, stepper, color |
| 5 | `kaleidoscope` | Polar mirror segments | stepper, slider, xy |
| 6 | `noise-field` | fbm + domain warping | slider (log), vec3, color |
| 7 | `feedback-trails` | Backbuffer accumulation | slider, texture (self), toggle |
| 8 | `truchet-weave` | Procedural tile system | stepper, slider, color, select |
| 9 | `sdf-sphere` | Raymarched sphere with lighting | vec3, color, slider, xy |
| 10 | `chromatic-glitch` | Aberration, scanlines, block displace | slider, toggle, trigger |

Collectively these cover **all ten `ControlKind` values**, which is the point. If the inspector renders this set correctly, it renders anything.

### Sketch set

| # | Slug | Concept | p5 surface covered |
|---|---|---|---|
| 1 | `particle-burst` | Emitter with physics and trails | 2D, vectors, blend modes |
| 2 | `flow-field` | Perlin-driven particle advection | noise, particle systems |
| 3 | `recursive-tree` | Branching L-system with jitter | recursion, transforms |
| 4 | `koch-snowflake` | Iterated fractal edge | recursion, geometry |
| 5 | `bezier-lab` | Draggable control points, curve families | `bezier()`, pointer input |
| 6 | `orbit-sphere` | 3D sphere with `orbitControl()` | WEBGL, camera, lighting |
| 7 | `terrain-wireframe` | Perlin landscape mesh, animated | WEBGL, `beginShape`, noise |
| 8 | `shader-texture` | GLSL shader applied to 3D geometry | `loadShader`, `texture()` |
| 9 | `harmonograph` | Damped Lissajous curve plotter | parametric math, `beginShape` |
| 10 | `type-grid` | Typographic grid with variable weight | typography, `textFont`, layout |

`shader-texture` is the deliberate bridge between the two libraries: a p5 sketch consuming a GLSL asset. It is the first thing that will break when the renderer contract has a gap, which makes it a useful canary.

### Phasing

| Phase | Seed work |
|---|---|
| 0 | Lock both authoring conventions; write **1 shader + 1 sketch** as reference implementations |
| 1 | Author the remaining 18; `scripts/seed.ts`; posters generated through the normal ingest path |
| 2 | Seed set becomes the performance test corpus — real GPU load, not placeholders |
| 3 | Seed set becomes the inspector fixtures; all ten control kinds verified against real assets |

---

## 9. Performance budget

Hard numbers. Treat a regression as a build failure.

| Metric | Budget |
|---|---|
| Concurrent live renderers | ≤ 6 |
| WebGL2 contexts | 1 shared (fallback pool ≤ 4) |
| Board scroll | 60fps with 40 cards |
| Initial JS (board route) | Framework baseline + **≤ 60KB app code**, gzipped |
| Poster image | ≤ 40KB, WebP, 480px long edge |
| Sandbox heartbeat timeout | 2000ms |
| Time to first poster paint | < 1.2s on 4G |

> **Revised after Phase 0.** The original budget was a flat 200KB gzipped total.
> Measured first-load on the finished Phase 0 shell — no renderers, no WebGL, no
> editor — came in at **204KB gzipped**, essentially all React 19 + Next 16
> baseline; app code was roughly 10–15KB of it. A flat total budget was therefore
> unmeetable from the first commit and told us nothing. Budgeting app code above
> the framework floor is both achievable and diagnostic: it fails when *we*
> regress, not when the framework ships.

**Techniques:** posters as static `<img>` until promoted; `content-visibility: auto` on offscreen cards; shader programs cached by source hash; a single `requestAnimationFrame` loop driving every renderer (never one per card); `OffscreenCanvas` where supported.

---

## 10. Design tokens

The brief pins the palette, so it is followed exactly.

```css
:root {
  /* surfaces */
  --bg-canvas:  #000000;   /* main board — pure black, always */
  --bg-surface: #0D0D0F;   /* header, drawers */
  --bg-raised:  #16161A;   /* cards, inputs, popovers */
  --border:     #262629;
  --border-hi:  #35353A;

  /* text */
  --text:       #E8E8EA;
  --text-dim:   #6E6E76;
  --text-mute:  #45454C;

  /* accent */
  --accent:     #00D3FF;
  --accent-dim: #00D3FF26;   /* 15% — fills, focus rings */

  /* type */
  --font-ui:   'Geist', system-ui, sans-serif;
  --font-mono: 'Geist Mono', ui-monospace, monospace;

  /* scale */
  --step--1: 0.75rem;  --step-0: 0.875rem;  --step-1: 1rem;
  --step-2: 1.25rem;   --step-3: 1.75rem;

  --radius: 3px;
  --gap: 12px;
}
```

**Discipline that keeps this from looking cheap:**

- Accent appears on **at most one element per screen region** — selection, focus, or active state. Never decoration.
- No shadows, no gradients, no glows. On pure black a 1px `--border` hairline reads better than any of them.
- All parameter values, uniform names, and metadata set in `--font-mono`. It is the one place the interface signals what it is.
- Cards are flush rectangles at `--radius: 3px`. The artwork carries every bit of colour on screen.

**Signature element:** the inspector drawer is the memorable thing. Controls stack in mono-labelled rows with live numeric readouts, and a modulated parameter's readout *moves* — a value visibly breathing in response to audio is the one moment of motion in an otherwise completely still interface.

---

## 11. Open decisions

Resolve these before Phase 2. Each one cascades.

| # | Decision | Options | Blocks |
|---|---|---|---|
| 1 | GL context strategy | One shared + FBO blit **vs** pool of ≤4 | Phase 2 |
| 2 | Board ownership | Single-user **vs** shared from v1 | Data model, auth |
| 3 | p5 delivery | Bundled version **vs** CDN pinned per sketch | Sandbox design |
| 4 | Video export | WebM only **vs** MP4 via ffmpeg.wasm | Phase 6 scope |
| 5 | Canvas mode | Ships in v1 **vs** deferred to Phase 7 | Board data model |

Recommended defaults if you want to move now: **1** shared context, **2** single-user, **3** bundled, **4** WebM only, **5** deferred.

---

## 12. Risk register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| WebGL context loss on a busy board | High | High | Single shared context; `webglcontextlost` handler restores from source hash |
| Runaway user sketch freezes the tab | High | High | Sandboxed iframe + 2s watchdog; never `eval` on main thread |
| Blob storage costs from raw video | Medium | Medium | Transcode on ingest; cap upload size; posters always served instead of source |
| Schema drift breaking saved params | Medium | Medium | `hydrate()` merge + schema `version` field; migration is additive-only |
| Scope creep into a full VJ tool | High | Medium | Phase gates with explicit exit criteria; timeline work is Phase 7+ |
| Mobile GPU can't run heavier shaders | Medium | Low | Quality tiers; posters-only mode below a device-capability threshold |

---

## 13. Definition of done (per phase)

- [ ] Strict TypeScript, no `any` in the diff
- [ ] Keyboard-navigable with visible focus
- [ ] `prefers-reduced-motion` respected
- [ ] Responsive to 375px
- [ ] Error boundary on the route
- [ ] No console warnings in a clean session
- [ ] Performance budget re-measured, not assumed

---

## 14. Post-v1 backlog

Ordered by leverage, not by appeal.

1. **Board canvas mode** — free-position infinite canvas alongside the grid. Grid browses; canvas composes.
2. **Blend layers** — stack two assets through a GLSL blend pass. Much of this shader code already exists in the BlendCraft work.
3. **Local-first** — IndexedDB cache with optimistic writes; the board works offline and feels instant.
4. **MIDI in** — WebMIDI mapped onto the modulation bus. Nearly free given the control-schema abstraction.
5. **Timeline / sequencer** — sequence board items into a playable set with crossfades. This is the point where the tool becomes a VJ rig.
6. **Version history for code assets** — cheap, since sources are already text rows.
