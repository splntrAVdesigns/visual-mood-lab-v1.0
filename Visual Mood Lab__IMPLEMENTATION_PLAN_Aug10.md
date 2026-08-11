# Visual Mood Lab — Implementation Plan

**Status:** Phases 0–4 shipped and stabilized; app chrome unified across routes and an About page added (§7 Phase 4.5) — Phase 5 (Playground) is next, see rationale in §7
**Last updated:** 2026-08-10 (rev 5 — Phase 0–4 checklists reconciled with actual shipped state; §7 Phase 4.5 added; Phase 5 rationale added; §8 revision note; §15 auth-pivot and mobile-snapshot-priority entries added)

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
| Auth | Auth.js | Single provider (GitHub) is enough for v1 — **revised in practice; see §15** |

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

> **Revision note (rev 5):** actual routing ended up flatter than planned — `app/page.tsx` (board), `app/about/page.tsx`, and `app/asset/[id]/page.tsx` are top-level rather than grouped under `(board)`/`(lab)`; `(auth)` is the one route group that did ship, holding `login`/`signup`/`forgot-password`/`reset-password`/`verify`. `features/navigation/` also grew an `AppChrome.tsx` not anticipated here — see §7 Phase 4.5.

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

### Phase 1 — Library ✅ COMPLETE

- [x] Drizzle schema + Neon, migrations
- [x] Signed-URL upload flow; client uploads direct to blob storage
- [x] Server-side poster generation (`sharp` for images/SVG, `ffmpeg` frame grab for video)
- [x] Dominant-colour extraction at ingest
- [x] `image` / `svg` / `video` renderers
- [x] Grid with tags, type filter, and search
- [x] Auth — shipped broader than planned: Credentials (email/password) with email verification is the primary path, GitHub is an optional linked method rather than the sole provider. See §15 for the session-strategy bug this uncovered.
- [x] Seed library authored — grew well past the original 20; see §8 revision note
- [x] `scripts/seed.ts` — loads `seed/` through the normal ingest pipeline

**Shipped.** §15 documents the 403 / broken-URL / missing-delete / poster-404 upload bugs found and fixed post-launch.

**Exit criterion met:** seed script produces correctly-postered, correctly-tagged assets in the grid; hand uploads behave identically.

### Phase 2 — Live rendering ✅ COMPLETE

- [x] `lib/gl/context-pool.ts` — shared WebGL2 context, FBO render targets, blit to card canvases
- [x] `shader.renderer.ts` + program cache + compile error surfacing
- [x] `lib/sandbox/` — iframe host, message protocol, watchdog, error overlay
- [x] `p5.renderer.ts` running library sketches through the sandbox
- [x] Renderer pool with LRU eviction, max 4–6 live
- [x] `IntersectionObserver` promotion: `poster → preview → focused`
- [x] Global pause; `prefers-reduced-motion` honoured

**Shipped.** §15 documents the retina/WebGL context-loss chain (density budgeting, resize timing, Strange Attractor batching) found and fixed post-launch — worth reading before touching `densityFor()` or resize handling again.

**Exit criterion met.**

### Phase 3 — The inspector ✅ COMPLETE

- [x] `parseUniforms()` wired into shader ingest; schema cached on the asset row
- [x] One component per `ControlKind` in `features/inspector/controls/`
- [x] Grouped, ordered rendering with the Advanced disclosure
- [x] `showIf` conditional visibility
- [x] Debounced param persistence (250ms) with optimistic local state
- [x] `hydrate()` on load so schema changes never break saved params
- [x] Param snapshots → `BoardItem.paramsOverride`
- [x] Deep-linkable focused view at `/asset/[id]`
- [x] Seed set verified as inspector fixtures — every control kind rendered and persisted

**Shipped**, plus a split not in the original plan: `FocusedAssetOverlay` (desktop) and `MobileFocusedView` (below ~820px) are now both wired in and CSS-gated by breakpoint. `MobileFocusedView` existed fully built well before this but was never mounted anywhere — see §7 Phase 4.5 and the now-elevated-priority item in §15.

**Exit criterion met.**

### Phase 4 — Modulation bus ✅ COMPLETE

- [x] `lib/modulation/` — shared clock, Web Audio analyser, LFO bank
- [x] Right-click a modulatable control → assign a source, set amount and rate
- [x] Visual indicator on modulated controls
- [x] One audio input shared across all live renderers

**Exit criterion met.**

### Phase 4.5 — App chrome & About (unplanned, completed 2026-08-10)

Not on the original roadmap — surfaced from actually using the app on a phone and wanting a real About page, not roadmap-driven. Small enough in scope not to warrant a full phase number, but it changed a structural assumption the rest of the app was built on, so it's recorded here rather than left implicit.

- [x] `AppHeader` + `NavDrawer` + dialogs extracted from `AppShell` into a new `AppChrome` — previously the header/drawer only existed because the board page happened to mount them; now any route can.
- [x] `/about` — real route, same `AppChrome`, same `Hero`, a four-quadrant grid (Concept / Capabilities / Roadmap / brand). Fetches assets + user server-side the same way the board page does, so drawer counts and the account row are correct there too, not an empty shell.
- [x] `NavDrawer` made route-aware: Board/Type/Tag actions now navigate to `/` before applying a filter if you're not already there — these were pure store mutations that only ever made sense while `BoardGrid` was mounted, which stopped being guaranteed once the drawer became shared chrome.
- [x] `MobileFocusedView` wired into `AppShell`, CSS-gated at the existing 820px mobile breakpoint against `FocusedAssetOverlay`.
- [x] Drawer account/logout row moved into `Drawer`'s own `footer` slot (a real pinned footer via flex layout, outside the scrollable body) rather than a sticky-positioned child — the earlier attempt assumed a scroll-container shape `Drawer` doesn't actually have.

**Why this matters for what's next:** the chrome is no longer board-specific. Playground, whenever it lands as its own route, gets the same header/drawer/hero for free instead of needing its own copy — this phase is partly what makes Phase 5 cheaper to ship correctly the first time.

### Phase 5 — Playground (est. 1.5 weeks) ← **next**

> **Why this is next, not Canvas mode or Export:**
>
> 1. **It's the next phase in the sequence this plan already defined**, and everything it needs already exists and is de-risked: `parse-uniforms.ts` (GLSL → schema) is written and tested, the p5 `params` export convention is proven across the seed library, and CodeMirror was already the chosen editor in §2. Canvas mode and Blend layers (§14 backlog) are comparatively unscoped — Playground is the backlog item with the least remaining uncertainty.
> 2. **It's already a public commitment.** The About page's Roadmap quadrant lists `playground` as `[building]` — that's now user-facing copy, not an internal note. Shipping it closes a promise already made rather than opening a new one.
> 3. **It unlocks Export's actual value.** Phase 6 (PNG/WebM capture) is most useful once people have made something worth exporting. Sequencing Playground first means Export ships against real user-created content instead of only the seed library.
> 4. **It's the feature that matches the About page's own pitch** — "come play while it's free" reads as a slogan until there's an actual from-scratch authoring surface backing it up.

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

Twenty hand-authored assets were originally planned: 10 GLSL shaders and 10 p5.js sketches. Image and video assets are uploaded manually by the owner.

> **Revision note (rev 5):** the shipped library grew well past this — 21 shaders / 29 sketches, 50 total. The tables below are the original planning set only; the additional ~30 assets aren't itemized here since their concepts and control coverage weren't tracked in this document as they were added. Worth backfilling if this doc is going to keep being the source of truth for what the seed set actually exercises.

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

### Shader set (original 10 — see revision note above for the full 21)

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

### Sketch set (original 10 — see revision note above for the full 29)

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
| 1 | Author the remaining assets; `scripts/seed.ts`; posters generated through the normal ingest path — shipped, grew to 50 total (see revision note) |
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

> All five are resolved in practice as of Phase 2–4 shipping (the recommended defaults above are what's actually running) — left unmarked rather than retroactively checked off, since this table's value going forward is mainly as a record of what was decided and why.

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

---

## 15. Known issues resolved (post-rev-3 debugging cycle)

A cluster of regressions surfaced after the auth work landed — fullscreen, upload, and a couple of sketch defaults. Documented here because several took multiple attempts to root-cause correctly, and the false starts are worth keeping a record of so they aren't retried.

### Auth architecture (rev 5 addition)

- **Auth.js v5 Credentials provider is incompatible with `session.strategy: 'database'`** — it always issues JWT cookies regardless of the configured strategy, which isn't obvious from the docs and cost real debugging time before landing on it as the actual cause. **Fix:** switched to `strategy: 'jwt'`, with server-side revocation via a `revokedAt` column compared against the token's `iat`, so "log out everywhere"-style revocation is still possible without database-backed sessions.
- **Email verification** added via `lib/auth/verification.ts` — 32-byte hex token, 24h TTL, single-use, gated behind an explicit button click on the confirmation page rather than firing automatically on link-load. This was deliberate, not incidental: email scanners/link-prefetchers were hitting the verification link and silently consuming the single-use token before the actual person clicked it, so the token being "already used" on first real click looked like a bug until traced to prefetch behavior.

### Fullscreen / WebGL

- **Root cause, WEBGL sketches failing in fullscreen on retina displays:** `densityFor()` in `public/sandbox/index.html` applied a flat `min(devicePixelRatio, 2)` multiplier regardless of canvas size. On retina, native fullscreen resolution at 2x density produced a large enough one-shot WebGL drawing-buffer allocation to trigger `CONTEXT_LOST_WEBGL` on some GPU drivers. Non-retina displays never hit this because the multiplier stayed at 1x. **Fix:** density is now budgeted against a total framebuffer pixel count (~4M px) and scales down as needed rather than applying a flat multiplier, recalculated on every resize rather than once at mount.
- **Root cause, resize timing:** the sandbox originally inferred "the transition has settled" from its own internal `window.resize` event stream, which is not a reliable settle signal during an animated fullscreen transition. **Fix:** `P5Renderer` now observes the actual host container via `ResizeObserver` and sends an explicit `resize` message (already defined in `lib/sandbox/protocol.ts` but previously unused) once it settles; this is the primary resize trigger now, with the sandbox's internal handling kept only as a fallback.
- **Root cause, sketches recovering from context loss but returning blank when leaving fullscreen (Orbit Sphere, Transform Shape):** the fallback above and the new explicit host message briefly ran on independent timers, so both could fire for the same physical resize — each doing a full `resizeCanvas()`, together blocking the sandbox's main thread long enough (300–800ms per call, confirmed via console capture) to blow through the `P5Renderer` heartbeat timeout (2000ms), at which point the host tore the iframe down as a hung sketch. **Fix:** the fallback now checks whether the host's message handled the resize recently and skips if so, removing the double-execution rather than tuning timing further.
- **Root cause, Strange Attractor specifically failing/stuttering regardless of the above:** the sketch issued one `p.point()` WebGL draw call per point — ~8,600 draw calls/frame at its shipped default of 7,400 points, plus a per-point glow pass with its own `push()`/`pop()`. This was the actual performance floor; the fullscreen fixes above only mattered once this was addressed. **Fix:** points are now sorted into 28 colour buckets per frame and drawn via one batched `beginShape(POINTS)`/`vertex()`/`endShape()` per bucket (~56 draw calls/frame total), working around a p5 limitation where `beginShape(POINTS)` doesn't honor per-vertex `stroke()` (processing/p5.js#7839). Param schema unchanged; existing saved params still hydrate.
- **F key intermittently not registering:** the sandboxed sketch iframe is cross-origin (`sandbox="allow-scripts"`, null origin) — once a person interacted with a sketch, keyboard focus could move into the iframe, and its keydown events never bubble to the host document. **Fix:** the sandbox now forwards `f`/`Escape` keydowns to the host via `postMessage`; `P5Renderer` re-dispatches them as real host-level `keydown` events so existing shortcut listeners work unchanged.
- **Header actions (Code / Modulate / Save snapshot) missing on a newly opened asset:** `FocusedAssetOverlay`'s `isFullscreen` state wasn't included in its per-asset reset effect, so a stuck `true` left behind by a previous asset's fullscreen failure carried into the next asset opened. Fixed alongside a defensive reset if `requestFullscreen()` rejects outright.

### Upload

- **403 "Cannot get token from authorization header or cookie":** `VercelBlobStorage.createSignedUpload()` embedded the client token in the upload URL's query string; Vercel Blob's storage backend expects it as an `Authorization: Bearer` header. Fixed in `lib/storage/index.ts`, with the client-side PUT in `UploadDialog.tsx` updated to send the header.
- **Uploads succeeding but the resulting URL failing to load:** the app was guessing the public URL's domain (`blob.vercel-storage.com`) rather than reading Vercel's actual store-specific URL (`<storeId>.public.blob.vercel-storage.com`) from the PUT response body. Fixed by reading the real URL from the response instead of constructing one.
- **No way to delete an uploaded asset:** `DELETE /api/assets/:id` didn't exist (405). Added, with best-effort non-fatal storage cleanup and a delete affordance in the focused-asset header, gated to `image`/`svg`/`video` types (never a seed asset, so this can't target shared library content without a separate ownership flag).
- **Library-asset poster capture always 404ing:** the poster-capture route required exact ownership match, but shared library assets (e.g. `strange-attractor`) are owned by a fixed library account, not the viewer. Real captured posters are meant to be a shared upgrade. Added `loadPosterWritable()` in `app/api/assets/[id]/route.ts`, used only by the `POST` (poster) handler — `PATCH` (params) and `DELETE` remain strictly own-only.

### Sketch defaults

- **Transform Shape / Orbit Sphere "Solid" render mode effectively invisible:** both sketches defaulted `fillColor` to near-black (`~0.05` per channel) combined with dim ambient light (0.12–0.15), rendering solid faces indistinguishable from the pure-black canvas background. Raised both sketches' default fill brightness and ambient light. Transform Shape's fill default has since been tuned twice more for contrast against its cyan edge default — most recently to magenta (`#FB00FF`) — since a merely-visible fill still read as a dim variant of the same look rather than a genuinely different render mode.
- **Transform Shape wireframe visibly clipped/cut off:** likely cause is the shape's rotated silhouette (cylinder/cone have real axial extent) exceeding the camera's field of view at the default size of `0.51 × canvas`, since the sketch never explicitly configures the camera and relies on p5's auto-computed perspective. Addressed with a size safety margin (`× 0.82`) rather than restructuring the camera, since the exact mechanism (frustum framing vs. near-plane clipping) wasn't confirmed interactively — flagged for a closer look if the margin doesn't fully resolve it.

### Still open

- **Mobile "Save snapshot" captures the wrong image** (an error placeholder, not the real captured frame). **Priority raised (rev 5):** originally filed when `MobileFocusedView.tsx` existed but was never mounted anywhere, meaning no one could actually hit this path through the app. As of Phase 4.5, `MobileFocusedView` is wired into `AppShell` and live in production on every phone-width session — this is no longer a theoretical gap in an unreachable component, it's an active bug real users can hit today. Root cause still not investigated; needs `features/board/MobileFocusedView.tsx` and/or the mobile-specific capture call path. Worth picking up before or alongside Phase 5 given it's now reachable, even though it isn't formally blocking Playground.
