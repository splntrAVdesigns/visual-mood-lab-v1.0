# Visual Mood Lab — Implementation Plan

**Status:** Phases 0–4 fully shipped, including the audio-input half of the modulation bus. Phase 4.5, 4.6, 4.7 complete. Phase 4.8 (tile sound presets, audio-**out**) Stages 1–2 shipped; Stage 3 remains ongoing content work. Phase 4.9 core is complete and stabilized; Phase 4.9.1 remains planned. Phase 4.95 (now the recommended next phase, rev 20 — see §7 Phase 4.99) and Phase 5.5 remain planned. Phase 4.96 is complete. **Phase 4.97 code is present in the build through sub-phase 4.97G (repo audit, rev 14); real-hardware QA and exit-criterion sign-off remain to be reconciled.** **Phase 4.98 Floating Sidecar Panels (desktop) is SHIPPED, merged to `main` as `a3cfbe9`, verified in Chromium by automated suite and owner-verified on the Vercel preview in Safari and Firefox. A related backdrop-click bug (pre-existing, not caused by 4.98) was found, fixed, owner-tested, and SHIPPED, merged to `main` as `f6566f6` on 2026-09-21 (owner-tested on the preview, then merged); the fix commit is `eaa609a` on top of the Phase 4.98 merge `a3cfbe9` — see `SPRINT_FLOATING_PANELS.md` §11–12.** **Live Output work (Stage page + pop-out, OBS Browser Source link) and everything that depended on it (Live Session Bus, Mobile Companion Controller, Spout2/Syphon bridge) is deferred as of rev 14; OBS remains usable today through Window/Display Capture.** Design detail is in `VISUAL_MOOD_LAB_FLOATING_PANELS_INTEGRATION_PLAN.md`; the earlier `VISUAL_MOOD_LAB_PHASE_4_98A_4_98B_6_5_INTEGRATION_PLAN.md` is retained as deferred reference. **Phase 4.99 — Shapeshift (Mood Tile #100) is SHIPPED, merged to `main`.** A new shader tile and its supporting primitive, `lib/shape-source/` (text/SVG/PNG/JPG → signed distance field → GPU texture), reused by Phase 5.5 as its mask source. Built across four rounds — initial build, a performance and element-grid rewrite, and an orientation/centring/upload-keying fix — all owner-tested on the local build; see the new Phase 4.99 section below and `docs/SHAPESHIFT_TILE_100_CONCEPT.md` for full detail.

**Mood tile library is now at 100 assets** (up from 63 at rev 6 / 65 at rev 7 / 90 at rev 11), across shader and p5.js renderers — Shapeshift (Phase 4.99) is asset #100.

**Last updated:** 2026-09-23 (rev 20 — Phase 4.99 (Shapeshift, mood tile #100) SHIPPED and merged to `main`; the tile library moves to 100 assets and Phase 4.95 is now the recommended next phase — see its updated status note and the reasoning in the new Phase 4.99 section. Rev 19 — the 'Latest Update' ticker, built and verified on rev 18, is now confirmed merged to `main` (`e1aeae2`). Rev 18 — the scrim-click fix (rev 17) is now merged: merged to `main` as `f6566f6` on 2026-09-21 (owner-tested on the preview, then merged); the fix commit is `eaa609a` on top of the Phase 4.98 merge `a3cfbe9`. Owner confirmed the merged fix passed testing. Rev 17 — Phase 4.98 Floating Sidecar Panels SHIPPED: merged to `main` as `a3cfbe9` on 2026-09-21; owner-verified on the Vercel preview that the app loads and functions in Safari and Firefox. A pre-existing backdrop-click bug, exposed by owner testing of Phase 4.98 but not caused by it, was found and fixed (`lib/ui/backdrop-dismiss.ts`, on branch `fix/scrim-click`, not yet merged as of this revision); see §0 and `SPRINT_FLOATING_PANELS.md` §12. Corrects a rev 16 error: no slider drag was ever affected by the bug — `Slider` captures the pointer, so its drags always completed correctly; the bug only affected presses on plain content (panel text, the tile). Rev 15 — Phase 4.98 Floating Sidecar Panels implemented on `feat/floating-panels` and verified in Chromium (72-check browser suite, 82-check layout verifier, all existing verifiers, build); browser testing found and fixed a header-click-closes-overlay bug; Safari/Firefox preview QA and merge pending. Rev 14 — re-sequenced after a source audit of the current build: Phase 4.98 is now Floating Sidecar Panels (desktop) with a stack accordion; the Live Output slices (Stage page + pop-out, OBS link) and the Live Session Bus, Mobile Companion Controller, and native bridge are deferred with re-entry triggers; stale status items corrected — `getTrackFrequencyData()` is already guarded, the renderer budget is device-scaled at 1–3, and Phase 4.97 code exists through 4.97G. No application code was changed by this planning revision.)

---

## 0. Current build status at a glance (updated, rev 14)

A quick-scan summary for "what's done, what's stable, what still needs work" — the phase-by-phase detail below remains the source of truth, but this section exists so nothing gets lost in a 2,000-line doc.

**Shipped and stable:**
- Phases 0–4 (shell, library, live rendering, inspector, modulation bus)
- Phase 4.5 (app chrome & About), 4.6 (seed library expansion + board-sync fix), 4.7 (tile interactivity & polish)
- Phase 4.8 Stages 1–2 (sound presets — Field Lines, Acid Melt proof of concept)
- Phase 4.9 core (mic + track modulation input) — now including the mobile lifecycle stabilization work
- Phase 4.96 (VFX rack expansion)
- Phase 4.98 (Floating Sidecar Panels, desktop) + the backdrop-click fix — merged to `main`
- The "Latest Update" ticker — merged to `main`
- **Phase 4.99 (Shapeshift, mood tile #100) — new this revision.** Ships with a new reusable primitive, `lib/shape-source/` (text/SVG/PNG/JPG → distance field → GPU texture), two new renderer-contract annotations (`@shape`, `@trigger`), and a new `file` control kind — see the Phase 4.99 section
- Modulation system — six-fix pass + `baseParams` systemic fix
- Mood tile library — **100 assets**

**Still needs work (tracked, not yet executed):**
- **Phase 4.8 Stage 3** — remaining synthesized-tile sound presets (Batch 1: Static Choir, Star Field, Cursor Ripple, Chorus of Eyes; Batch 2: Wound Thread, SVG Particle, Digital Matrix, Grid Snake — Batch 2 still blocked on owner-supplied `.wav` files)
- **Phase 4.9.1** — sound-panel UX consolidation (two volume sliders, mismatched meter, preset/track mutual-exclusivity) — diagnosed, awaiting build approval
- ~~`getTrackFrequencyData()` defensive wrapping~~ — **resolved (verified rev 14):** `safeGetTrackFrequencyData()` in `lib/render/pool.ts` wraps the call, so the earlier "still not wrapped" status was stale. It remains the pattern the control-surface loops must not repeat (§9, §7 Phase 4.97)
- **Mobile "Save snapshot" wrong-image bug** — still open, still not root-caused, now actively reachable in production (see §15)
- **Phase 4.95** (Media & Graphic Asset Library) — **recommended next phase (rev 20).** Planned, not started; now the most de-risked and most valuable item in the backlog with Phase 4.99 shipped — see the reasoning in the new Phase 4.99 section below
- **Phase 5.5** (Blend & Mask Mode) — planned, not started; SVG-mask-rendering decision (§11 #6) still genuinely open
- **Phase 4.97** (MIDI & Control Surface Integration) — **code present through sub-phase 4.97G** (rev 14 repo audit): `lib/control-surface/` MIDI + gamepad runtimes, learn, session-safety boundary; `features/controllers/`; a Controllers tab inside Modulation. The staged roadmap in §7 (Stage 0–5) uses different labels than the in-code 4.97A–G tags — reconcile them and run real-hardware QA before marking the exit criterion met; see `MIDI_CONTROL_SURFACE_CONCEPT.md`
- **Deferred (rev 14):** **Phase 6.5A** Stage page + pop-out window · **Phase 6.5B** OBS Browser Source link · Live Session Bus (formerly 4.98B) · **Phase 6.25** Mobile Companion Controller · **Phase 6.5.6** Native GPU bridge (Spout2/Syphon). Re-entry triggers: integration plan §6
- **Touch XY performance pads** (Modulate/VFX) — approved direction; now unblocked by Phase 4.98 rather than by the former floating output tile

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
│  │  ├─ fbo.ts
│  │  └─ effects-compositor.ts      # ← VFX rack compositing (Phase 4.96)
│  ├─ sandbox/                      # iframe bridge, message protocol, watchdog
│  ├─ modulation/                   # param bus: time, audio FFT, LFO, (MIDI/gamepad — Phase 4.97)
│  ├─ sound/                        # tile-as-instrument engines (Phase 4.8)
│  ├─ effects/                      # VFX rack types + registry (Phase 4.96)
│  ├─ control-surface/              # MIDI / gamepad / future webcam input — Phase 4.97, not yet built
│  ├─ storage/
│  └─ db/
├─ stores/                          # board, playback, inspector, theme, mod
├─ components/ui/                   # primitives: button, slider, drawer, dialog
└─ styles/tokens.css
```

**Rule of thumb:** if two features need it and it has no domain knowledge → `components/ui/`. If it has domain knowledge → the feature that owns it, exported from the feature's `index.ts`.

> **Revision note (rev 5):** actual routing ended up flatter than planned — `app/page.tsx` (board), `app/about/page.tsx`, and `app/asset/[id]/page.tsx` are top-level rather than grouped under `(board)`/`(lab)`; `(auth)` is the one route group that did ship, holding `login`/`signup`/`forgot-password`/`reset-password`/`verify`. `features/navigation/` also grew an `AppChrome.tsx` not anticipated here — see §7 Phase 4.5.

> **Revision note (rev 10):** two more top-level routes are planned but not yet built: `app/media/page.tsx` (§7 Phase 4.95) and the Blend & Mask sidecar, which is a drawer rather than a route and so lives in `features/blend/` alongside a new `stores/blendStore.ts`, not under `app/` at all (§7 Phase 5.5). Following the rev 5 pattern, expect the actual paths to flatten similarly once built.

> **Revision note (rev 11):** `lib/effects/` and `lib/gl/effects-compositor.ts` are now real, shipped code (Phase 4.96), not planned paths — added to the tree above. `lib/control-surface/` is added to the tree as a **planned, not-yet-built** path for Phase 4.97, flagged the same way `features/blend/` was flagged at rev 10 ahead of its own phase starting.

> **Revision note (rev 12):** Phase 4.98 adds a public renderer-only route under `app/output/[shareId]/`, owner and token-validation endpoints under `app/api/output-*`, client UI under `features/live-output/`, and server grant/projection/transport code under `lib/live-output/`. VCapture owns setup; the output route owns playback only. The route must not import `FocusedAssetOverlay`, the Inspector, or board navigation. See the Phase 4.98/6.5 companion plan for the source-audited file map.

> **Revision note (rev 13):** keep output rendering in `features/live-output/`, but move reusable roles, envelopes, command validation, host leases, and transport adapters into `lib/live-session/`. Future mobile UI belongs in `features/mobile-controller/`. This separation prevents OBS output, mobile control, popup windows, and a possible native Spout2/Syphon bridge from each inventing their own synchronization layer.

> **Revision note (rev 14):** the `features/live-output/`, `lib/live-output/`, `lib/live-session/`, and `features/mobile-controller/` paths above are **deferred, unbuilt** as of rev 14. New planned paths for Phase 4.98: `features/panels/` (`FloatablePanel`, `PanelModeButton`, `useFloatCapable`, `panelSlot.module.css`), `stores/panelLayoutStore.ts`, `lib/panels/` (`layout.ts` pure logic, `config.ts` kill switch), and `scripts/verify-panel-layout.ts`. If Live Output resumes, the Stage page is planned at `app/stage/[itemId]/` (cookie auth) and the OBS route at `app/output/[shareId]/` — see the integration plan §4–5.

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
  soundState?: SoundState;            // Phase 4.8 — tile-as-instrument binding
  soundOverride?: SoundState;         // per board-item override, mirrors paramsOverride
  effectsState?: EffectsState;        // Phase 4.96 — VFX rack chain (up to 3 effects)
  controlSurfaceState?: ControlSurfaceState;      // Phase 4.97, planned — discrete MIDI/gamepad bindings
  controlSurfaceOverride?: ControlSurfaceState;    // Phase 4.97, planned — mirrors soundOverride

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
  soundOverride?: SoundState;    // Phase 4.8
};
```

**`paramsOverride` is the highest-leverage field in the schema.** It turns twelve shaders into sixty distinct board items at zero storage cost.

Store code assets as **text in Postgres**, not blobs. They become searchable, diffable, and versionable for free.

> **Revision note (rev 10):** Phase 4.95 proposes two more additive fields — `packId` / `collection` and `isPremium` — scoped to the graphic-asset library rather than mood tiles. Phase 5.5 proposes a new `BlendState` shape, kept in its own Zustand slice rather than folded into `Asset`/`BoardItem`, since a blend relationship is between two board items, not a property of either one alone. See each phase's section in §7 for the reasoning; neither is written as a full type here yet since neither has been built or reviewed.

> **Revision note (rev 11):** `effectsState` (Phase 4.96) is now real, shipped shape, not a proposal — added above. `controlSurfaceState` / `controlSurfaceOverride` (Phase 4.97) are added as **planned** fields, deliberately mirroring `soundState`/`soundOverride` exactly, per the project's own established pattern of new fields mirroring existing parallel fields. Full shape is in `MIDI_CONTROL_SURFACE_CONCEPT.md` §8 — not duplicated here until the phase actually starts, consistent with how Phase 5.5's `BlendState` is handled above.

> **Revision note (rev 12):** Phase 4.98 adds a separate `OutputGrant` bound to `boardItems.id`, since the selected card's `paramsOverride`, `modOverride`, `soundOverride`, and `effectsOverride` define the output look. Store only the token hash; return the raw bearer secret once on create/rotate. The allowlisted `OutputProjection` contains the resolved render fields. Shader/p5 source is included because the browser renderers require it; owner identity, board inventory, editor state, and write capabilities are excluded.

> **Revision note (rev 13):** Phase 4.98B adds a transient `LiveSession` boundary around the output grant rather than expanding `OutputGrant` into a collaboration model. Each client joins with one role (`workspace-host`, `output-viewer`, future `mobile-controller`, or `display-viewer`). Mobile writes are typed `ControlCommand` envelopes validated by role, session, board-item target, sequence, and payload; the workspace host remains authoritative and returns canonical acknowledgements/revisions. Controller capability tokens are short-lived, same-account, explicitly approved, and separate from OBS bearer URLs.

> **Revision note (rev 14):** the `OutputGrant` and `LiveSession` shapes above are deferred with Live Output. When that work resumes, the smaller `output_links` table in the integration plan §5 (owner, board item, token hash, created, nullable expiry, revoked-at) replaces the larger `OutputGrant` shape, and no `LiveSession` is needed for the first release.

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

> **Why this matters for Phase 4.95 (rev 10):** the entire upload → poster → tag → grid pipeline built here is what makes the new Media page cheap. Nothing in §1's asset-type table changes; Phase 4.95 is a second page and a curated pack riding this same pipeline, not new renderer work.

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

> **Why this matters for Phase 5.5 (rev 10):** the FBO-per-tile / blit-to-canvas design here is exactly what makes a blend compositing pass a natural extension rather than a new subsystem — see §7 Phase 5.5.

> **Why this matters for Phase 4.96 (rev 11):** the same FBO-per-tile design is also what made the VFX rack's up-to-three-effect GPU compositing chain a natural extension rather than new subsystem work — the shared context already renders each live tile to an FBO before the final blit; the effects compositor just inserts itself between those two steps. See §7 Phase 4.96.

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

### Phase 4 — Modulation bus ✅ COMPLETE (rev 10 — both halves shipped; rev 11 — hardened)

- [x] `lib/modulation/` — shared clock, Web Audio analyser, LFO bank
- [x] Right-click a modulatable control → assign a source, set amount and rate
- [x] Visual indicator on modulated controls
- [x] ~~One audio input shared across all live renderers~~ — **delivered by Phase 4.9.**

**Exit criterion met in full.**

**Stability pass (new, rev 11):** a six-fix diagnostic and repair pass ran across `lib/modulation/bus.ts`, `lib/sound/autoGain.ts`, `lib/sound/track.ts`, `renderers/control-schema.ts`, `features/inspector/SoundPanel.tsx`, and `features/inspector/ModulationPanel.tsx`, closing out the "erratic jump on Play/toggle" complaint and a set of default-value policy gaps:

1. `track.ts`'s `startSourceAt()` now resets `BandAutoGain`'s baseline on every playback start, so a stale "silence" baseline never ambushes the first real transient after Play.
2. `bus.ts` fades every newly-active routing in from neutral over 350ms (smoothstep) — source-agnostic, so it fixes the general "toggle anything on → jump" pattern, not just audio.
3. `bus.ts`'s smoothing filter is now `dt`-normalized against a 60fps reference, so a given Smoothing value behaves the same at 30fps and 120fps instead of drifting with refresh rate.
4. New `defaultSmoothingFor(source)` — source-aware smoothing defaults (0.25 audio, 0.3 mic, 0 others).
5. New `defaultAmountFor(control)` — amount defaults scaled inversely to a control's declared range, rather than one flat default regardless of span.
6. New `pickSafestModulationTarget(controls)` — replaces the old schema-order `[0]` auto-assign fallback with the narrowest-range eligible control, avoiding accidental extreme-swing auto-assignments.

All three new functions are centralized as exports in `bus.ts`, consumed by both `SoundPanel.tsx`'s auto-assign helpers and `ModulationPanel.tsx`'s manual assignment path.

**Separate systemic fix, found via field testing (Turbulent Flow, Morph Speed unresponsive):** `lib/render/pool.ts`'s `entry.baseParams` — the "offset-from" value `applyModulation()` uses — was built from `asset.params` alone, with no merge against schema defaults. Any control added or re-tuned *after* a tile's params were last saved had no key in `baseParams`, so `applyModulation()`'s `if (base === undefined) continue` silently skipped that routing permanently, with no error surfaced anywhere. Fixed by mirroring what every renderer already does internally: `{ ...defaultsOf(asset.schema), ...(asset.params ?? {}) }`. This was explicitly framed as a **systemic** fix, not a one-tile patch — worth remembering that any tile whose schema changed after its params were last saved could have silently had this same bug before this fix landed.

An earlier root-cause investigation (Motion Blur "stuck at 0.35–0.39" across every `audio.*`/`mic.*` source, app-wide) found `BandAutoGain.apply()` was using ratio-to-recent-peak normalization, which mathematically pins near 1.0 for sustained/compressed signals — rewritten to baseline-deviation, the mechanism now used consistently across the module. This is captured as a standing principle in project memory ("baseline-deviation reactivity is the correct mechanism... ratio-to-recent-peak mathematically pins near 1.0").

### Phase 4.5 — App chrome & About ✅ COMPLETE (unplanned, completed 2026-08-10)

Not on the original roadmap — surfaced from actually using the app on a phone and wanting a real About page, not roadmap-driven. Small enough in scope not to warrant a full phase number, but it changed a structural assumption the rest of the app was built on, so it's recorded here rather than left implicit.

- [x] `AppHeader` + `NavDrawer` + dialogs extracted from `AppShell` into a new `AppChrome` — previously the header/drawer only existed because the board page happened to mount them; now any route can.
- [x] `/about` — real route, same `AppChrome`, same `Hero`, a four-quadrant grid (Concept / Capabilities / Roadmap / brand). Fetches assets + user server-side the same way the board page does, so drawer counts and the account row are correct there too, not an empty shell.
- [x] `NavDrawer` made route-aware: Board/Type/Tag actions now navigate to `/` before applying a filter if you're not already there — these were pure store mutations that only ever made sense while `BoardGrid` was mounted, which stopped being guaranteed once the drawer became shared chrome.
- [x] `MobileFocusedView` wired into `AppShell`, CSS-gated at the existing 820px mobile breakpoint against `FocusedAssetOverlay`.
- [x] Drawer account/logout row moved into `Drawer`'s own `footer` slot (a real pinned footer via flex layout, outside the scrollable body) rather than a sticky-positioned child — the earlier attempt assumed a scroll-container shape `Drawer` doesn't actually have.

**Why this matters for what's next:** the chrome is no longer board-specific. Playground, the new Media page, and the Blend sidecar all get the same header/drawer/hero for free instead of needing their own copy — this phase is a large part of what makes each of them cheaper to ship correctly the first time.

### Phase 4.6 — Seed library expansion & board-sync fix ✅ COMPLETE (unplanned, completed 2026-08-10)

Prep work ahead of Phase 5, prompted directly by early user feedback: the library needed more range before Playground's "fork an existing asset" flow inherits it as the starting fixture set.

- [x] Seed library grown 50 → 63 — 8 new shaders, 5 new p5 sketches. See §8 for the full list, and for the uniform-annotation syntax, GLSL→control-kind mapping, and `manifest.json` schema, all documented in full for the first time.
- [x] Found and fixed a real data-layer bug surfaced by the expansion: new library assets weren't reaching existing accounts' boards. See §15 for the full root-cause writeup.

**Why this matters for what's next:** Playground's "fork an existing asset" and "live-parsed uniform annotations → controls appear as you type" both depend on §8's syntax and mapping tables being accurate — this phase is what makes them a reliable reference instead of something to reverse-engineer from `parse-uniforms.ts` mid-build. It also means the next seed batch (there will be one) shouldn't need this same debugging cycle again.

### Phase 4.7 — Tile interactivity & polish pass ✅ COMPLETE (unplanned, completed 2026-08-11)

Direct follow-through on Phase 4.6's own feedback loop: testing the expanded library surfaced real bugs, some in seed assets and two in application code the seed work doesn't normally touch.

- [x] Two new pointer-driven tiles added (63 → 65): `field-lines`, `ink-trail`. Both shipped as p5 in the end — their original shader versions depended on `u_pointer`, a name the parser recognizes as reserved (so it won't generate a stray control) but that `shader.renderer.ts` never actually binds a value to (only `u_mouse` is set, in pixel space). Worth remembering for any future shader wanting pointer input: use `u_mouse`, not `u_pointer`.
- [x] Nine existing tiles substantially reworked on direct user feedback: free-text input (the `text` control kind) added to Type Wave and Glyph Swarm; Digital Matrix and Wound Thread converted shader → p5 for real characters and full interactive shape-morphing (five presets plus a free-form mode) respectively; Acid Melt, Hue Vortex, Liquid Blobs (renamed from Liquid Glass — the effect never actually read as glass), Static Choir, and Orbit Debris all gained secondary colors, additional pattern/shape variants, and finer control.
- [x] Real bugs found and fixed along the way, not just feature requests: Glyph Swarm's scatter trigger fired on ambient pointer movement near the canvas rather than a deliberate drag, permanently suppressing cohesion during ordinary Inspector testing; a GLSL reserved-keyword collision (`flat` used as a local variable name) broke Orbit Debris outright; three sketches with canvas-size-dependent precomputed data (Glyph Swarm, Wound Thread, Chorus of Eyes) went stale specifically in Fullscreen — see §15 for the full root-cause writeup, since it's a real, reusable finding about how the sandbox handles that specific transition.
- [x] Inspector text-control focus-steal bug fixed: `Drawer.tsx`'s dismiss/focus-management effect listed an inline, non-memoized `onClose` as a dependency, so it re-fired on every keystroke typed into any text control and yanked focus to the header's restore button mid-word. Fixed at both the call site (`InspectorDrawer` now memoizes `onClose`) and inside `Drawer.tsx` itself, which now guards the focus-steal/restore behavior behind an actual open→closed transition rather than "the effect happened to re-run."
- [x] Tooltip overflow fixed — a new `align` prop lets a tooltip anchored near a viewport edge grow `start`/`end` instead of always centering off-screen — and a global Tooltips on/off preference shipped (`useTooltipsEnabled`, defaults off on every platform), wired into the Settings dialog.

**Why this matters for what's next:** Playground's own authoring loop leans on exactly the mechanisms this pass hardened — live param editing that doesn't fight the user for input focus, pointer-reactive controls, and the `text`/`select`/`trigger` control kinds all now have real, tested precedent across the library rather than being exercised for the first time inside the editor itself.

### Phase 4.8 — Tile sound presets ("mood tiles as instruments") ← Stages 1–2 ✅ COMPLETE, Stage 3 in progress

A mood tile's own live parameter values also drive a small audio subgraph — motion becomes sound organically, using data the tile is already producing. Architecturally a sibling to Phase 4's modulation bus, not a dependency of it: that system is audio-**in** (sound → visuals, Phase 4.9); this is audio-**out** (visuals → sound). Full concept doc, updated separately: `SOUND_PRESETS_CONCEPT.md`.

- [x] **Stage 1 — Foundation:** `lib/sound/` module (`SoundBinding`/`SoundPreset` types, shared `AudioContext` singleton mirroring `context-pool.ts`); `soundState`/`sound_override` JSONB columns on `assets`/`board_items` alongside `ModState`; focus-tied lifecycle (start on promote-to-focused, dispose on blur, extending `AssetRenderer.dispose()`); master volume/mute in the header; real-time signal meter (`SoundMeter.tsx`).
- [x] **Stage 2 — Proof of concept, Field Lines + Acid Melt:** shipped well past the original 7-control scope. See `SOUND_PRESETS_CONCEPT.md` §"What actually shipped" for the full record; headline items:
  - `ArpEngine` (scheduled AND event-triggered) and `PadEngine` (synth chord + sample-transposed), five presets each
  - **Graze-to-pluck** — a `triggerMode: 'event'` model where a sketch fires discrete trigger events itself (`p.pluck(x)` → sandbox → `pluckTileAudio()`) instead of a hover-gated schedule. The single biggest departure from the original concept doc, and the reason Stage 3's tile list below is organized around it
  - **Note rack** replaced the single-value Key select: up to 3 simultaneous roots, a real chord on the pad engine, a merged/widened scale pool on the arp engine, and — as of Stage 2 — deselectable to zero as a per-tile mute independent of the master Sound toggle
  - **Humanize & Swing**, added beyond the original plan's scope entirely, each with a genuinely different implementation per engine (arp: timing/pitch/velocity jitter, or accent-based swing in event mode; pad: slow detune drift, or alternating tremolo-depth swing)
  - Envelope question resolved as **fixed per-engine plus per-preset bindings** — not revisited
- [ ] **Stage 3 — Remaining synthesized tiles, split into two batches by implementation risk, not tile order** (see `SOUND_PRESETS_CONCEPT.md` for full rationale):
  - **Batch 1 (next):** Static Choir, Star Field, Cursor Ripple, Chorus of Eyes — all reuse `ArpEngine`/`PadEngine` exactly as they exist today, zero new engine code
  - **Batch 2:** Wound Thread (needs a genuinely new `abstract` engine), SVG Particle (reuses `ArpEngine` but needs design work on the emission→pluck mapping), Digital Matrix + Grid Snake (still blocked on owner-supplied `.wav` files)
- [ ] **Stage 4 folded into Stage 3, batch 2** — Digital Matrix and Grid Snake's sample-loader work happens alongside batch 2, still blocked on the owner supplying `.wav` files
- [ ] **Stage 5 — Polish & Playground handoff:** full QA pass; confirm `SoundBinding`/`SoundPreset` are stable and documented enough for Playground's own authoring surface to build against — the note rack, humanize/swing, and graze-to-pluck all need to be part of that documented surface now, not just the original 7 controls

**Sequencing note (rev 10):** Stage 3 is content/instrument-authoring work on already-shipped mechanisms, not new platform capability — it can run interleaved with Phase 4.9.1, 4.95, 4.96, or Phase 5 without blocking any of them, and doesn't need to be "finished" before the roadmap moves forward. It's tracked here because it's real outstanding work, not because it's gating anything below.

**Status check (rev 11): still open, unchanged.** Not touched this revision — flagged again in §0 so it doesn't quietly fall off the radar while Phase 4.96/4.97 work gets attention.

**Exit criterion:** all 10 tiles are genuinely playable instruments, each stage's checkpoint held before moving to the next, and the sound-binding schema — including `triggerMode`, `defaultOctave`/`defaultNotes`, and the humanize/swing fields — is stable enough that Playground doesn't need to redesign it later.

### Phase 4.9 — Audio-reactive input: mic + uploaded-track modulation ✅ COMPLETE (core + stability hardening) — Phase 4.9.1 next

This is the item Phase 4 originally left unchecked (§7 Phase 4, "one audio input shared across all live renderers") — deferred deliberately through Phases 4.5–4.8 because Playground and full audio integration were always sequenced together near the end of the roadmap. It's the audio-**in** counterpart to Phase 4.8's audio-**out**: instead of a tile's motion driving sound, external sound now drives a tile's motion, through the same `lib/modulation/` bus an LFO source already uses.

- [x] Per-card uploaded audio track (`track.ts`) usable as a modulation source, independent of the global mic input
- [x] Live microphone input wired as a modulation source into the existing bus alongside the LFO bank
- [x] Root-caused and fixed a real regression this surfaced: uploading a track was blacking out every live tile on the board, not just the one with the track. Traced to a buffer-size mismatch between `track.ts`'s `waveAnalyser` and the existing `meter.ts` analyser — both now share `fftSize = 256`. Confirmed from source, not just from observed behavior.
- [x] `SANDBOX_RUNTIME_VERSION` bumped in `lib/sandbox/protocol.ts` to bust cached sandbox iframes carrying the old, broken buffer size

**Stability hardening (new, rev 11) — pushed and shipped, closing out the "not yet pushed" status from rev 10:**

- [x] `context.ts` gained `attachAudioLifecycleListeners()` — resumes the shared `AudioContext` on `visibilitychange` and on `pageshow`/`persisted` (the iOS bfcache case), mounted once from `AppShell.tsx`.
- [x] The "gate the meter so it doesn't report stale/garbage levels while suspended" fix, originally scoped to `meter.ts` alone, was extended to all three level-getters — `meter.ts`, `track.ts`, and `mic.ts` — since `track.ts`'s `getTrackLevel()` is the one actually implicated in real mobile bug reports (Track has playback priority over Mic/synth in `SoundMeter.tsx`).
- [x] New `attachTrackVisibilityLifecycle()` in `track.ts` — auto-pauses all playing tracks on `visibilitychange`/`pagehide`, so the UI's Play/Pause icon always reflects reality on return rather than showing Pause for audio that's actually gone silent in the background.
- [x] Full context/graph recovery path added to `startSourceAt()`: calls `resetAudioContextForRecovery()`, rebuilds the track's gain/tapGain/analyser subgraph via a new `rewireTrackGraph()` helper, and retries playback once if the initial attempt throws — covers the case where the OS has fully torn down the `AudioContext` (a `closed` state), not just suspended it.
- [x] `context.ts`'s `ensure()` updated to treat a `closed` `AudioContext` as "no context" rather than trying to reuse the dead object.
- [x] Both new lifecycle functions mounted in `AppShell.tsx` as separate `useEffect` calls, following the existing mounting pattern.

**Explicitly not touched in this pass, flagged for awareness:** `meter.ts`'s `getWaveform()` (feeds the p5 `audioWaveform` bridge — e.g. Static Choir) was deliberately **not** gated the same way the level-getters were — it wasn't implicated in the reported bug, and always returning *some* buffer (even a stale one) is safer for that call site than introducing a new `null` case a sketch might not expect. Worth a follow-up pass only if visual staleness is actually observed on those specific tiles after a background/foreground cycle.

**Known sharp edge — RESOLVED (verified rev 14):** `getTrackFrequencyData()` was flagged (rev 10) as being called inside the shared `tick()` loop outside the per-card `try/catch`. The shared loop lives in `lib/render/pool.ts` (not `lib/gl/context-pool.ts`, as earlier text said), and the call is now wrapped by `safeGetTrackFrequencyData()` — a throw is caught, logged once per card, and treated as "no track data this frame". Kept here as the reason MIDI/gamepad polling still gets its own isolated loop rather than piggybacking on the renderer tick (see `MIDI_CONTROL_SURFACE_CONCEPT.md` §9).

**Exit criterion (4.9 core): met, and now field-hardened.** Mic and uploaded-track audio both reach the modulation bus and drive `@mod`-tagged parameters exactly as an LFO source does, and playback survives the mobile background/foreground and OS-teardown cases that weren't covered when this was first marked core-complete at rev 10.

#### Phase 4.9.1 — Sound-panel UX consolidation (diagnosed, not yet coded — unchanged this revision)

Shipping the track/mic input fast surfaced a UI debt the original single-source panel was never designed to carry: built-in synth presets (Phase 4.8) and an uploaded track are currently shown as if they're two independent, simultaneous concerns, when the intent is that a loaded track *replaces* the preset, not sits alongside it.

- [ ] Sound panel grows too tall once a track is loaded — no vertical budget was planned for the added row
- [ ] Two volume sliders exist at once (preset volume + track volume), with no indication that only one is actually live
- [ ] Loop and Mute toggles sit on separate rows for no structural reason
- [ ] Built-in sound presets stay audibly active after a track is uploaded instead of yielding to it — should be mutually exclusive, and visually disabled once a track is loaded, not silently overridden underneath an unchanged-looking control
- [ ] Audio meter isn't wired to track playback at all — it only reflects the synth engine, so it reads as broken the moment a track is the actual source
- [ ] Meter label is misaligned in the toggle row
- [ ] Replace / Remove track buttons need to share a row rather than stack

**Planned fix (awaiting approval to build, per Blang's usual confirm-before-build pattern — §"Approach & patterns" in project memory):** loading a track collapses preset-editing controls entirely rather than showing both; loading a track auto-stops the synth engine; volume consolidates to a single contextual slider that always reflects whichever source is actually live; the meter wires to whichever source is active, live or recorded.

**Exit criterion (4.9.1):** the sound panel shows exactly one active source's controls at a time, at a fixed height regardless of state, with a meter that's honest about what's actually playing.

**Why this matters for what's next:** Phase 5.5 (Blend & Mask Mode) wants blend/mix amount to be a modulatable parameter like any other — that's a clean addition only if the modulation bus's input side is stable and its UI isn't still actively shifting under it. Phase 4.97 (MIDI) adds new `Source` entries to that same per-param dropdown (see `MIDI_CONTROL_SURFACE_CONCEPT.md` §3) — one more reason it's worth clearing 4.9.1 before more consumers land on the bus's UI surface, even though nothing about 4.9.1 strictly blocks either phase.

### Phase 4.95 — Media & Graphic Asset Library (est. 4–6 days) — recommended next phase (rev 20)

**Owner-directed, recommended to land before Playground.** Reasoning for the placement, not just the content, matters here:

1. **It reuses almost everything already built, at low risk.** `svg` and `image` are already first-class `AssetType`s (§1, §5) with working posters, upload, and `BASE_CONTROLS` transform controls since Phase 1. This is a new **page and curated content pack**, not new renderer or renderer-contract work — the cheapest kind of scope to add without disturbing anything already shipped.
2. **It unblocks Phase 5.5 properly.** The owner's stated goal — "blend and mask... to expand the visual moods of asset tiles" — needs a real, browsable shape library to mask *against*. Building Phase 5.5 first would mean building it against an empty or improvised asset set.
3. **It doesn't meaningfully delay Playground.** Playground is still the next roadmap-committed capability phase — this is a short, mostly-independent detour, not a re-sequencing of it.
4. **Phase 4.99 just de-risked the parts of this phase that weren't already low-risk (rev 20).** The one piece of genuinely new logic this phase called for — an SVG normalization/ingest pass (fill-color rewriting, viewBox handling) — has a working, owner-tested sibling in production now: `lib/shape-source/svg.ts` already sanitizes and viewBox-normalizes arbitrary uploaded SVGs (originally for Shapeshift's Upload source), and the same per-tile upload flow, signed-URL handling, and `verify-*` pattern this phase would build from scratch are proven. Shapeshift's "Library" shape source (five original stand-in shapes, by explicit decision at its kickoff) is also functionally waiting on this phase's asset pack — landing 4.95 doesn't just satisfy Phase 5.5's stated need for a browsable mask library, it also upgrades a tile already in production.

**What it is not:** a new renderer. This phase is a surface built on top of infrastructure Phase 1 already finished.

- [ ] New top-level nav entry, **Media**, placed directly below **Board** in the left drawer. Page title: "Media & Graphic Asset Library."
- [ ] Reuses `AppChrome` (Phase 4.5) and the existing `Hero` component at the top of the page — same structural pattern as Board and About, no new chrome
- [ ] Upload/import controls section directly below the hero: SVG, transparent PNG, and — reusing the existing `video.renderer.ts` and signed-URL upload flow from Phase 1 — video import, through the same pipeline already in production
- [ ] **Relocation, not duplication:** the "library uploads" affordance currently reachable from Board's left drawer moves here. Board's drawer keeps its Type/Tag/filter actions (Phase 4.5); raw asset import becomes Media's job specifically — one place uploads happen, not two
- [ ] Preset asset grid below the import controls, reusing the existing card-grid component from `features/board/` (Architecture Principle 5 — this is a config/data difference, not a new component)
- [ ] Selecting a preset or an imported asset opens the same Phase 3 inspector, with the existing `BASE_CONTROLS` transform set (position, scale, rotation, opacity) — no new control kinds required for v1
- [ ] Ship the first graphic pack as launch content: 42 hand-authored vector assets — icons, abstract/geometric cell patterns, HUD/sci-fi elements, orbital and radial motifs (the owner-supplied "SVG Custom Embeds" set) — loaded through `scripts/seed.ts`'s existing ingest pipeline, exactly like the board's mood-tile seed library. Same "if seeding works, upload works" principle as §8, applied to a second, separate library

**Ingest-time technical note, confirmed directly against the supplied pack:** every sampled file uses hardcoded fill colors baked into each path (`fill:#ededee`, `fill:#fff`, etc.), not `currentColor`. As shipped, none of them can be recolored or tinted through a control the way a shader's `@color` uniform can today. Before these are useful as tintable/maskable assets — which is the actual point of the feature — ingest needs a normalization pass that rewrites literal fill values to `currentColor` and exposes a bound color control, conceptually the same binding `parse-uniforms.ts` already does for a GLSL uniform. This is the one piece of genuinely new logic in an otherwise low-risk phase; flagging it now rather than discovering it mid-build.

**Also worth doing at ingest, not after:** viewBoxes in the supplied pack aren't consistent (`0 0 1024 1024` vs. `0 0 1024 568`, both observed directly in the pack), which is unremarkable for hand-authored icon work but will visibly misalign previews in a uniform grid if left alone. A lightweight `verify-media-assets.ts`, sibling to `verify-seed.ts`, that checks viewBox/aspect-ratio and flags outliers before they reach the grid is cheap insurance, especially since designer-sourced files don't carry the same structural guarantees `parse-uniforms.ts` enforces on code assets.

**Data-model note, cheap now / expensive later:** the owner has stated intent to monetize future graphic packs. Adding `packId`/`collection` and an `isPremium` flag to the asset row now — with commerce completely unbuilt — costs nothing today (every asset in this first pack is simply `packId: 'svg-custom-embeds-01'`, `isPremium: false`) and avoids a migration plus data backfill later. Same category of decision as the schema-drift risk already tracked in §12.

**Exit:** the Media page opens from its own drawer entry, shows the 42-asset starter pack in a responsive grid, lets a user import their own SVG/PNG/video alongside it, and every asset — preset or imported — opens in the existing inspector with working transform controls.

**Explicitly deferred to Phase 5.5, not built here:** actually using these assets as masks or blend layers against mood tiles. This phase only builds the library and its browsing surface; consuming that library from another asset's blend/mask controls is Phase 5.5's job. Keeping the split clean avoids this phase quietly growing into Phase 5.5's scope before either is properly designed.

**Status check (rev 20):** not started. Promoted from "planned" to **recommended next phase** now that Phase 4.99 (Shapeshift, mood tile #100) has shipped — see point 4 above and the new Phase 4.99 section (§7). Still recommended to run ahead of Playground and Phase 5.5.

### Phase 4.96 — VFX rack expansion ✅ COMPLETE (NEW this revision, completed prior to rev 11 and formally logged here)

**New phase number this revision** — this work landed since rev 10 but was never given its own phase entry until now; logged in full so the roadmap's completed-work record matches reality. A full diagnostic, bug-fix, and expansion pass on the three-effect-per-tile GPU-compositing VFX rack introduced alongside the modulation bus's compositing groundwork (§7 Phase 2).

- [x] **Diagnostic pass:** traced the full chain from `VfxPanel.tsx` UI → store → modulation bus → GL uniform binding across the effects manifest, all GLSL shaders, effect type definitions, registry, compositor, render pool, and control schema.
- [x] **Bug fix — Math Warp:** the "Formula"/Swirl mode was unreachable due to a type mismatch — `select`-kind control values are strings, but the uniform binding path only forwarded `number`/`boolean`/`array` types. Fixed in `effects-compositor.ts`, mirroring the exact pattern already used in `shader.renderer.ts` for the same class of problem.
- [x] **Dead code removed:** `toModulationControls()` in `registry.ts` had zero call sites and described a superseded design — removed, with an explanatory comment documenting what the real mechanism actually is, so it isn't reintroduced by accident.
- [x] **`usesEcho` generalized:** Dark Strobe's echo-buffer mechanism was previously gated by a hardcoded `dark-strobe` string check in `effects-compositor.ts`. Replaced with a data-driven `EffectDefinition.usesEcho` flag — Dark Strobe's original opt-in-via-`echo>0` behavior preserved exactly, but any future effect can now opt into the same mechanism without a compositor code change.
- [x] **Six new effects shipped**, prioritized by a Tier 1/2 framework (new plumbing vs. none):
  - **White Strobe** (Tier 1) — reuses `dark-strobe.frag` with a new `u_flashColor` uniform
  - **Grain** (Tier 1) — stateless per-pixel noise, mono or per-channel color
  - **CRT** (Tier 2) — barrel distortion + scanlines + RGB mask + vignette
  - **Noise Displacement** (Tier 2) — smooth value-noise UV warp, joins the `warp` family alongside Math Warp
  - **Graphic Slice** (Tier 2) — row-banded glitch displacement on a stepped clock; first member of the `slice` `EffectFamily`, reserved in `VfxPanel.tsx` since the original catalog scoping
  - **Turbulent Feedback** (Tier 2) — reuses the generalized echo-buffer mechanism as its core, not a bonus knob; the accumulated trail is resampled through turbulent noise before blending back over the live frame
- [x] Two new `EffectFamily` values added (`texture`, `feedback`); `VfxPanel.tsx`'s `FAMILY_ORDER` updated to include both plus the now-populated `slice`.
- [x] **Field bugs found and fixed after initial delivery:** Grain rendered as thin vertical bands instead of noise and aliased against tile motion; CRT aliased similarly and appeared to reverse drift direction. Root-caused via Python simulation of the actual GLSL math at real canvas resolutions rather than guessing: `hash(vec2)` — used in Grain, and quietly present in Noise Displacement and Turbulent Feedback too — was safe for normalized UV-scale inputs but was being fed raw pixel-cell coordinates in Grain (values in the thousands), causing float32 precision collapse in `fract(p.x*p.y)` and producing coherent banding rather than noise. That coherent periodic structure was what aliased against motion. Fixed with a precision-safe hash idiom (`fract(vec3(p.xyx) * 0.13)`), applied to Grain and proactively to Noise Displacement and Turbulent Feedback as well. CRT's scanlines were separately hardcoded to a 2px period — the absolute Nyquist limit, guaranteed to alias at any tile speed — fixed with a new `u_scanlineDensity` control defaulting to a 3px period.
- [x] **Unplanned seventh effect — BrokeTV:** the vertical-banding artifact from the Grain precision bug was distinctive enough that it was preserved on request as its own deliberate effect rather than only being fixed away. Built clean using the safe 1D hash already precedented in `slice.frag`, bands driven by x-coordinate only, `rollSpeed` defaulting to 0 (fully static) so it carries no motion of its own to compete with the underlying tile's animation.

**This is now reflected in project memory as a standing principle:** `hash(vec2)` with raw pixel-coordinate inputs (values in the thousands) causes float32 precision collapse — use precision-safe hash idioms for any future GPU noise work, not just inside the VFX rack.

**Exit criterion: met.** All six planned effects plus BrokeTV are live in the rack, addressable through the existing three-effect-per-tile chain, Math Warp's Swirl mode works, and the field-bug root causes are documented as reusable findings rather than one-off patches.

### Phase 4.97 — MIDI & Control Surface Integration (NEW this revision — est. TBD, staged, not yet started)

**New this revision, owner-directed.** Full spec lives in the companion doc **`MIDI_CONTROL_SURFACE_CONCEPT.md`**, mirroring how `SOUND_PRESETS_CONCEPT.md` sits alongside Phase 4.8 — this section is the roadmap summary; the concept doc is the source of truth for interaction design, data shapes, and staging detail.

**The goal, in the owner's own framing:** with modulation stabilized, audio input hardened, VFX expanded, and 90 tiles to work with, the app has a stable enough foundation to become not just an experimentation tool but a **live-performance instrument** — mood tiles controllable from a real MIDI controller, or even a Bluetooth game controller, for installs and live events. Landing this **before** Playground means every user-authored tile gets control-surface binding for free from day one, rather than it being a retrofit onto user content later.

**Core architectural decision:** don't build a parallel system. MIDI CC and gamepad axes become new `Source` types inside the **existing** Modulation bus (Phase 4) — a knob wired to a slider shows up as `Source: MIDI – Slot 3` next to `LFO – Noise` and `Audio – Bass`, reusing Amount and Smoothing as-is. Discrete input (trigger/toggle/momentary on note-on or button-press) is the one genuinely new binding type, since it doesn't fit the continuous-modulation shape at all.

**Two settled decisions (resolved this revision, previously open):**

| Decision | Resolution |
|---|---|
| Pick-parameter targeting scope | Focused tile only, v1 — matches per-asset storage (`controlSurfaceOverride` mirrors `soundOverride`) |
| Fan-out (one slot → multiple params) | Yes, in v1 — see `MIDI_CONTROL_SURFACE_CONCEPT.md` §5. Nearly free for continuous params (the bus already supports many params pointing at one Source); requires one new small array structure for discrete triggers |

**UI placement:** no new top-level toolbar tab (already at seven: `GLSL / Code / VFX / Modulate / Sound / VCapture / Record`), no sidecar (already claimed by Phase 5.5). MIDI gets a second internal section inside the existing `Modulate` panel — a `Sources / Triggers` switch, same disclosure pattern the Inspector already uses for Advanced. A new **Settings > MIDI & Controllers** section handles device detection/pairing, Device Profiles, and a Panic control.

**Two-tier binding model:** a global, once-per-device **Device Profile** (MIDI-learn maps a physical control → generic Slot 1–8; gamepads mostly skip this via built-in W3C Standard Gamepad Mapping profiles) separated from a per-tile **Parameter Assignment** (click Slot → "Pick a parameter" → click the on-screen control). This split is what lets "Slot 3" mean the same physical knob across all 90 tiles during a live set, rather than requiring re-learning per tile.

**Slot count:** 8, matching the Modulation panel's existing "3 of 8 routed" convention — one number learned once across the whole app. Expanding to 12 later is a one-line constant change, not an architectural one.

**Pickup mode (takeover behavior):** default is **Pickup** — a physical control has no effect until it crosses through the param's current value, avoiding the value-jump that makes a MIDI implementation feel unfinished. Jump and Scaled available as per-target overrides.

**Staged roadmap** (full detail in the concept doc):

- [ ] **Stage 0 — Foundation:** `lib/control-surface/` scaffold, `ControlSurfaceSource` union type, mock device emulator, isolated poll loop
- [ ] **Stage 1 — Settings surface:** detection (Web MIDI + Web Bluetooth feature checks), device list, Enable/Pair flows, live activity monitor, Panic
- [ ] **Stage 2 — Device Profiles:** global hardware-learn flow, device-name-based persistence, built-in gamepad profiles
- [ ] **Stage 3 — Continuous bindings:** MIDI CC / gamepad axis entries in the existing per-param `Source` dropdown; pickup/jump/scaled takeover
- [ ] **Stage 4 — Discrete bindings:** new `Sources / Triggers` section, 8-slot pad grid, click-slot → pick-parameter flow with fan-out, Trigger/Toggle/Momentary modes
- [ ] **Stage 5 — Polish & real-hardware QA:** real MIDI controller + Xbox pad + PlayStation pad over Bluetooth + BLE-MIDI; first-run coachmark; confirm the binding schema is stable enough for Playground not to need a redesign later

**Critical implementation constraint, carried forward from Phase 4.9's own risk register (§12):** gamepad state has no native change events and must be polled every frame. The new poll loop must **not** repeat Phase 4.9's `getTrackFrequencyData()` pattern of running unguarded work inside `context-pool.ts`'s shared `tick()` loop, outside its per-card `try/catch`. MIDI/gamepad polling gets its own small, defensively-wrapped `requestAnimationFrame` loop, fully decoupled from renderer budget.

**Explicitly out of scope for v1, architected for:** board/session-level "Show Control" (cross-tile mapping, scene switching — a real future phase, more valuable for live VJ use than per-tile control but a different data shape entirely), MIDI clock sync to the existing Rate divisions, MIDI output/LED feedback, and webcam hand-tracking (the `ControlSurfaceSource` union is designed to grow a `webcam-gesture` variant later without rework).

**Exit criterion:** any modulatable param on any of the 90 tiles can be wired to a MIDI CC or gamepad axis with pickup-mode takeover; any trigger/toggle-kind param can be fired from a MIDI note or gamepad button, including fan-out to multiple targets from one physical control; Device Profiles persist across sessions and are reusable across every tile without re-learning; the system runs on its own isolated poll loop with zero measured impact on the ≤6 concurrent live renderer budget.

**Status check (rev 11):** newly scoped this revision. Not started. Sequenced after Phase 4.9.1, ahead of Phase 5 (Playground), parallel-safe with any remaining Phase 4.8 Stage 3 content work or Phase 4.95.

**Status check (rev 14):** a repo audit finds code through sub-phase 4.97G already in the build (see §0). The rev 11 status line above and the Stage 0–5 checklist predate it and are kept as the original plan; reconcile them against the in-code 4.97A–G tags and real-hardware QA.

### Phase 4.98 — Floating Sidecar Panels, desktop (next execution phase)

**Purpose:** let people on desktop pull the Sound, VFX, VCapture, and Modulation (including Controllers) sidecar panels out of the fixed left stack and place them anywhere in the app frame, and stop the stack from scrolling endlessly when several are open. Desktop only (≥ 821 px wide, fine pointer). The Inspector stays as is. Panels still close automatically when the person leaves the tile.

The companion documents are the source of truth: **`VISUAL_MOOD_LAB_FLOATING_PANELS_INTEGRATION_PLAN.md` §3** (behavior spec, architecture, edge cases) and **`SPRINT_FLOATING_PANELS.md`** (task breakdown, gates, QA matrix, git workflow).

**Decisions (rev 14, source-audited against `79bdfc0`):**

- **Float in place, no portal.** The panel's existing wrapper becomes `position: fixed`; it never moves in the React tree, so panel-local state (Modulation's selected tab and expanded row, Sound/VFX UI state) survives detaching and docking, and keyboard focus stays on the toggle. A portal (which remounts on container change) plus lifted state is the documented fallback if the P0 spike fails on any browser.
- **Accordion in stack mode.** Expanding a stacked panel collapses the other stacked panels; opening a panel expands it and collapses the rest; Shift-click expands additively; floating panels are exempt both ways.
- **Fix Modulation's collapse.** Today `.modPanel[data-collapsed]` hides only `.modPanelList`; Modulation's SIGNALS/CONTROLLERS tabs and Controllers view (`ui.desktopBody`) stay visible when collapsed, so the accordion needs that fixed on both tabs.
- **Persistence:** position, width, and mode per device in `localStorage` (`vml:panel-layout-v1`, versioned, defensively parsed); open and collapsed state are session-only.
- **Scope edges:** the Code panel stays docked (it drives the tile's shrink layout); MIDI stays inside Modulation's Controllers tab and floats with it.
- **Kill switch:** `NEXT_PUBLIC_FLOATING_PANELS=off` disables floating; the stack path is behavior-identical when nothing is floated.
- **Non-goals:** docking framework, tabs/splits/layout presets, corner-resize (v1.1), mobile, pop-out windows, OBS, any pool/renderer/sandbox/API/DB change.
- **Learned in browser testing (rev 15):** the pointer is captured only after the drag threshold (capturing on press made a plain header click close the whole overlay); detached panels are at least 320 px wide and the minimum width is 240; an inline *Dock all panels* header button exists because the overflow menu is invisible at desktop widths.

- [x] **P0 — Spike + baseline:** *(Chromium by automated run; Safari/Firefox confirmed by the owner on the preview)* prove fixed-in-stack positioning on Chrome, Safari, and Firefox; record a `LiveIndicator` fps baseline on the heaviest shader
- [x] **P1 — Pure logic, store, verifier:** `lib/panels/`, `stores/panelLayoutStore.ts`, `npm run verify:panel-layout`
- [x] **P2 — FloatablePanel, drag, snap, keyboard:** `features/panels/`, three icons, slot CSS; drag-release-over-scrim must not close the overlay
- [x] **P3 — Accordion, panel edits, overlay wiring:** lift collapse state into the store in all four panels; Modulation collapse fix; stacked-only `data-*` flags and spacer; *Dock all panels* in the header overflow menu
- [x] **P4 — Persistence, resize clamp, edge cases:** hydrate + clamp, resize re-clamp, kill switch, narrow/coarse-pointer behavior
- [x] **P5 — QA matrix on Chrome/Safari/Firefox** via a Vercel preview deployment — *Chromium passed (72-check suite + mobile, touch-tablet, kill-switch runs); owner confirmed the app loads and functions in Safari and Firefox on the Vercel preview*
- [x] **P6 — Docs and copy:** docs updated (rev 17); the optional onboarding/About line was intentionally not added (owner's call on wording)

**Exit:** with Sound, VFX, VCapture, and Modulation open, a person can drag any panel by its header out of the stack, place it anywhere in the app frame clear of the Inspector, move it with the keyboard, dock it back, and dock all; the focused tile never shifts; expanding a stacked panel collapses the others (Modulation on either tab included); a reload restores positions; leaving or switching tiles closes every panel; mobile is unchanged; the tile's frame rate is unaffected by dragging; `typecheck`, `lint`, `verify:panel-layout`, and `build` pass.

**Status check (rev 18):** **fully shipped, both Phase 4.98 and the scrim-click fix.** Phase 4.98 merged to `main` as `a3cfbe9` (feature commit `8978bf3` on top of the soak-test commit `b2939d9`). Verification: typecheck, lint (0 errors; same 53 warnings, none in new files), `verify:panel-layout` (82), all existing verifiers including `verify:soak` (68), `build`, and a 72-check Chromium browser suite (plus mobile, touch-tablet, and kill-switch runs). The owner then verified on the Vercel preview that the app loads and functions in Safari and Firefox. Two owner-review changes were made before merge: panels detach anchored by their right edge and widen leftward, away from the tile; and drag moves by transform (layout passes during a scripted drag 89 → 1). Owner testing then surfaced a pre-existing backdrop-click bug (shared by the focused view, the command palette, and Dialog — not caused by Phase 4.98): a press that begins on content and ends on the bare backdrop closed the view, because the browser fires that click on their common ancestor, the backdrop. Fixed, verified (21-check logic verifier, a 25-check browser suite reproducing the bug on unfixed code first, no regressions on any existing suite), owner-tested on its own preview, and merged — merged to `main` as `f6566f6` on 2026-09-21 (owner-tested on the preview, then merged); the fix commit is `eaa609a` on top of the Phase 4.98 merge `a3cfbe9`. See §0 and `SPRINT_FLOATING_PANELS.md` §12. Unblocks the Phase 5.5 Blend sidecar (as a fifth panel) and the deferred touch XY pads.

#### Deferred — Live Output (rev 14)

The former Phase 4.98A (Secure Clean Output) and 4.98B (Role-Aware Live Session Bus) are deferred and re-scoped: **6.5A** Stage page + pop-out window, **6.5B** OBS Browser Source link; the session bus and mobile controller are parked. Reasons and re-entry triggers are in `VISUAL_MOOD_LAB_FLOATING_PANELS_INTEGRATION_PLAN.md` §4–6. The full rev 2 design stays in `VISUAL_MOOD_LAB_PHASE_4_98A_4_98B_6_5_INTEGRATION_PLAN.md` (bannered as deferred) as the reference for contracts, security requirements, and the test matrix. Findings from the rev 14 source audit that any future Live Output work must carry forward:

- The renderer pool holds **one entry per tile, in one host**; a second host for the same tile tears the first down. A pop-out therefore cannot simply share the tile — it should be a separate page with its own pool.
- p5 sandboxes message the host `window` (`e.source === frame.contentWindow`); an iframe moved into a popup document would post to the popup, so "portal the tile into a popup" breaks every p5 tile.
- The shared GL stage is capped at 1280 px per side (`STAGE_ABSOLUTE_MAX_DIM`, set deliberately after a 2304 px regression), so fullscreen and any 1080p+ output are upscaled; a standalone single-renderer page can use its own higher ceiling — measure first.
- OBS Window/Display Capture works today; pressing **F** fullscreens the tile and hides the sidecars and header actions (the title bar with fullscreen/close remains).

### Board UI — "Latest Update" ticker (shipped outside the phase sequence, rev 19)

**Not part of Phase 4.98** — a separate, much smaller piece of work, built right after it. A thin, full-width, dismissible strip between the fixed header and the hero on the board page: a static "Latest update: <date>" label in `var(--font-mono)`, then a small recessed "LED window" (capped narrow, not full-bar-width) that scrolls the update's items right to left in `var(--accent)` cyan, pauses off-screen, and repeats.

**Why a full-width strip, not a corner badge on the hero or an addition to the header** (the two placements first proposed): measured directly rather than assumed.
- The hero has **no free corner on mobile** — at 360–390px wide its subtitle text already ends within about 20px of the card's bottom edge, confirmed by screenshot. A corner overlay there would overlap the subtitle or force the hero taller.
- The app already has an established convention that small fixed corner marks (`.footerCredit`, `.updatedMark` on the About page) are **hidden below 600px** — precedent that this codebase treats corner chrome as desktop-only, the opposite of "must show on mobile."
- The header is already at capacity: search and the onboarding CTA are both dropped below 720px just to keep it from overflowing on a phone.

A full-width bar in normal flow — inserted into `AppShell.tsx` directly above `<Hero />`, below the fixed header via `.main`'s existing `padding-top: var(--header-h)` — has none of those problems and needs no per-breakpoint corner logic. The animated part stays small and contained (the "small area, not the whole section" requirement) via the LED window's own `max-width`, independent of the bar spanning full width.

**Implementation:**
- **`lib/updates/dismissal.ts`** (new): pure logic — `shouldShowUpdate` (exact-match dismissal check, fails open on any non-string/garbage storage value), `formatUpdateDate` (ISO → MM/DD/YYYY, never throws), `formatUpdateItems`.
- **`features/updates/content.ts`** (new): the data — `{ date, items }`, hand-bumped like the About page's `updatedCopy.date`; bumping `date` is what brings the banner back for someone who already dismissed a previous update.
- **`features/updates/UpdateTicker.tsx`** + **`updateTicker.module.css`** (new): the component. Two-phase mount (render nothing until `localStorage` is read client-side, avoiding both a hydration mismatch and a flash of an already-dismissed banner); scroll distance and duration computed from measured pixel widths via `useLayoutEffect` + `ResizeObserver`, not hardcoded, so the pass always starts fully off the window's right edge and ends fully off its left edge at a steady reading speed regardless of message length; `@media (prefers-reduced-motion: reduce)` stops the animation and shows the full text statically instead, matching `Hero.tsx`'s own reduced-motion fallback.
- **Deliberately NOT built on the LED Display asset's p5 renderer** — that's a full per-pixel bitmap-font canvas sketch running through the shared render pool's per-tile budget; running it as permanent site chrome on every page load would spend part of that budget on UI, not an asset. A plain CSS `transform` animation on real text gets the same visual read (cyan mono text, LED-style window) at effectively zero cost.
- **`scripts/verify-update-ticker.ts`** (new) + `verify:update-ticker` npm script: 35 checks on the pure logic — exact-match dismissal, near-misses, hostile/wrong-typed storage, malformed dates, list formatting edge cases.

**Verification (Chromium; Safari/Firefox not tested):** 24 browser checks — placement below the header and above the hero at desktop and mobile widths, the LED window capped narrow rather than full-width, the animation actually moving with a JS-measured duration, dismiss-and-persist across reload, bumping the stored date to something older bringing a "new" banner back, the reduced-motion fallback showing static text with no movement, and confirming it renders only on the board page (not `/about`). `verify:update-ticker` 35/35. No regressions: typecheck clean; lint 54 problems / 0 errors (+1 warning vs. the 53 baseline — `react-hooks/set-state-in-effect` on the mount-time `localStorage` read, the same already-accepted pattern as the existing warning in `lib/hooks/useIsMobile.ts`, left rather than routed around); the Phase 4.98 browser suite (72/72), the scrim-click suite (25/25), the mobile/tablet suite (9/9), and all 17 existing verifiers including `verify:soak` (68) all still pass.

**Status (rev 19):** built and verified on branch `feat/update-ticker`; **not yet merged.**

### Phase 4.99 — Shapeshift (Mood Tile #100) & the Shape Source Primitive ✅ COMPLETE

**Owner-directed, unplanned** — added to fill the tile library's 100th slot with a deliberately general-purpose tile rather than another single-concept one, and to front-load the shape/mask infrastructure Phase 5.5 will need. Sequenced ahead of Phase 4.95 because the upload path it needed does not depend on the Media page, and its "Library" shape source is designed to be extended by the 4.95 pack once that ships rather than replaced by it.

**What it is:** a new shader tile, `shapeshift.frag`, that takes a shape from typed text, an uploaded SVG/PNG/WebP/JPG, or a small built-in shape library, and renders it as an audio-reactive composition — a choice of gradient, repeated-element grid, metaballs, or noise-mesh fill; three motion systems (Strip warp, Column step, Shard shift); and an optional pseudo-3D depth-stack extrusion with chromatic split. Concept, control schema, and build log: `docs/SHAPESHIFT_TILE_100_CONCEPT.md`.

**The reusable part, not just the tile:** `lib/shape-source/` turns text, an uploaded file, or a library shape into a signed-distance-field GPU texture, independent of Shapeshift. It is the mask-source primitive Phase 5.5 (§7) was always going to need and was flagged there as an open question (§11 #6, SVG-as-mask: GL texture vs. DOM `mask-image`) — that decision is now made and built: GL texture, because a CSS mask cannot take per-pixel audio-driven displacement or composite with the VFX rack.

**New renderer-contract surface (`lib/gl/parse-uniforms.ts`), reusable by any future shader:**
- **`@shape`** on a `sampler2D` — expands into a full Source control group (Text / Upload / Library, each showing only its own controls) and resolves the sampler through Shape Source instead of the existing texture-asset control. One sampler per shader.
- **`@trigger(toggleId)`** on a `vec2` — a fire-and-forget button (`[fireCount, secondsSinceFire]`); the named toggle makes the renderer auto-fire it on an audio transient. Used for Shapeshift's Re-cut / Re-cut on beat, reusable by anything else that wants a beat-synced trigger.
- New `file` control kind — a per-tile file upload (distinct from the existing board-asset texture picker: the file belongs to this tile only, per owner decision, not the shared asset library).

**Built and fixed across four rounds, each owner-tested on the local build before the next:**
1. **Initial build** — `lib/shape-source/` (raster, SVG sanitizer, font loader, worker-based distance-field builder, library shapes, per-tile upload), the contract additions above, `shapeshift.frag`, and `scripts/verify-shape-source.ts`. The distance field is seeded from antialiased coverage rather than a thresholded mask (the TinySDF approach) specifically to avoid stair-stepped edges at the resolutions a mood tile gets viewed at — verified numerically against an analytic shape (mean contour error 0.12 px) before being wired into GLSL.
2. **Performance + element-grid rewrite** — the depth stack originally re-ran motion and the full fill per layer (measured 3.0–4.8× slower than necessary at typical settings, and enough to stall the shared GL stage and, with it, the whole app's input responsiveness — every card's `drawImage` blit waits on the GPU). Rewritten to run motion once, fill only the front layer, and composite silhouette back-layers front-to-back with early exit. Element-grid fill rebuilt alongside it: neighbour-cell search so elements larger than their cell no longer clip, and depth-based sizing normalized to each shape's own deepest point (`u_shapeDepth`, computed by the distance-field builder) rather than a fixed constant, so it behaves the same on thin text and a solid logo.
3. **Orientation, centring, and upload-keying fix** — `ShaderRenderer`'s existing vertical-flip blit (documented at the call site, easy to miss from inside a new shader) meant every Shapeshift render was upside down; one `p.y` flip in `main()` fixed it. Auto image-keying was scanning the whole raster, including the transparent fit margin, so any opaque upload (a JPG, a white-background PNG) read as fully alpha and became a solid rectangle; keying now inspects only the image's own frame, and Luminance mode reads the image's border to pick polarity, so light-on-dark and dark-on-light uploads both key correctly with no manual invert. Default Tilt changed from 0.15 to 0 (it was the main cause of the tile looking off-center).

**Verification (all four rounds):** `glslangValidator`, `tsc --noEmit`, `verify-shape-source` (distance-field accuracy + schema-contract checks), `verify-seed` (100/100 assets), `verify-schema-fuzz`, `verify-roll`/`verify-roll-store`, `verify-tile-state`, `verify-render-pool`, `verify-control-surface`, `verify-midi-runtime`, `npm run build`, and a local `npm run seed`. Headless-Chromium renders of the real shader (text, SVG, library, and uploaded-JPG sources; each motion mode; the orientation/keying regression cases) were produced and inspected before each delivery. Final round owner-tested on the local build across desktop and mobile: text and uploads now render upright, centered, and with clean antialiased edges; all four sources (Text, Upload, Library — sources were functional from round 1) confirmed working.

**Exit:** tile #100 is in the seed manifest and the local database (100/100 assets), builds clean, and is owner-confirmed working — correct orientation, centring, and upload keying — on desktop and mobile. Merged to `main`.

**Explicitly deferred, by decision at kickoff:** cross-tile masking (another tile's output composited through Shapeshift's shape) stays with Phase 5.5, which will add it as a sixth fill type reusing the same Shape Source texture; a reusable, cross-tile shape library (today's uploads are per-tile only); user font upload (the curated set already used by other text tiles is enough for now).

### Phase 5 — Playground (est. 1.5 weeks)

> **Why this is next, not Canvas mode, Blend Mode, or Export:**
>
> 1. **It's the next phase in the sequence this plan already defined**, and everything it needs already exists and is de-risked: `parse-uniforms.ts` (GLSL → schema) is written and tested, the p5 `params` export convention is proven across the seed library, and CodeMirror was already the chosen editor in §2. Canvas mode and Blend Mode (§14 backlog, §7 Phase 5.5) are comparatively unscoped by comparison — Playground is the backlog item with the least remaining uncertainty.
> 2. **It's already a public commitment.** The About page's Roadmap quadrant lists `playground` as `[building]` — that's now user-facing copy, not an internal note. Shipping it closes a promise already made rather than opening a new one. Phase 4.95's insertion ahead of it (rev 10) is deliberately kept small enough not to jeopardize this.
> 3. **It unlocks Export's actual value.** Phase 6 (PNG/WebM capture) is most useful once people have made something worth exporting. Sequencing Playground first means Export ships against real user-created content instead of only the seed library.
> 4. **It's the feature that matches the About page's own pitch** — "come play while it's free" reads as a slogan until there's an actual from-scratch authoring surface backing it up.
> 5. **It gives Phase 5.5 better raw material (rev 10).** A Blend/Mask mode is more interesting once people can author their own shaders and sketches to blend with, not just the seed library. Sequencing Playground before Blend Mode means Blend Mode launches into a richer asset pool than it would otherwise.

- [ ] CodeMirror 6 with GLSL and JavaScript modes
- [ ] Debounced hot-reload (~400ms) with an inline error overlay
- [ ] Live-parsed uniform annotations → controls appear as you type
- [ ] Starter templates: p5 sketch, fragment shader, feedback shader
- [ ] Save sketch → becomes a library asset
- [ ] Fork an existing asset into the editor

**Exit:** write a shader from scratch in the browser, annotate a uniform, see the control appear, save it to the board, and reopen it as a normal asset.

> **Revision note (rev 11):** with Phase 4.97 now sequenced ahead of this phase, add one more reason to the list above: control-surface binding (MIDI/gamepad) will already be a property of the control-schema pipeline by the time Playground ships, so every sketch or shader a user authors here is automatically wireable to a controller with zero extra authoring work — a nice, free capability to point to in Playground's own onboarding copy once it exists.

> **Output compatibility gate (rev 12; deferred in rev 14):** when Live Output work resumes (Phase 6.5A/6.5B), every starter template and saved/forked Playground asset must render through the same renderer-registry path the Stage page uses, and any new runtime dependency, source form, or schema field must update the output projection allowlist in the same pull request. Until then, Playground needs only the standard renderer contract.

### Phase 5.5 — Blend & Mask Mode (est. 1.5–2 weeks) — planned, not started

**Promoted from §14 backlog item #2 ("Blend layers"), owner-directed and scoped in more detail than the original one-line backlog entry.** Proposed as a **sidecar drawer**: a third drawer surface alongside the existing left Nav drawer and right Inspector drawer. The shell was already built with a "header + side drawer + main + right drawer slot" (§4) — a sidecar drawer is an extension of a pattern that already exists, not a new UI paradigm.

**The concept:** opening the sidecar on a focused tile shows every board asset as a scrollable, selectable grid of 1×1 preview cards (reusing the same card-grid component as the Board and Media pages — Architecture Principle 5). Selecting one loads it as a blend source against the focused tile, exposing blend-specific controls. The owner's explicit ask, and the reason this is sequenced after Phase 4.9: blend/mix amount should be a modulatable parameter like any other, wired into the same bus an LFO or the live mic/track input already targets — blending should be able to breathe with audio exactly the way a shader's own uniforms do today.

- [ ] `BlendState` — new Zustand slice: active blend source asset ID, blend mode (multiply / screen / overlay / others TBD), mix amount, optional mask-asset reference, all scoped per focused tile — not folded into `Asset`/`BoardItem` (see §6 revision note) since a blend relationship is between two items, not a property of either one alone
- [ ] Sidecar drawer UI: card-grid reuse, plus a blend-mode select, mix-amount slider, and a mask-asset picker pulling from the Phase 4.95 Media library once that ships
- [ ] Compositing pass in `lib/gl/`: the shared WebGL2 context already renders each live tile to an FBO before blitting to its card canvas (§3, Principle 3; §7 Phase 2 — and now also proven out a second time by Phase 4.96's VFX compositing). Blending two tiles means compositing two FBO outputs through a blend shader before that final blit — real new GL work, but the shared-context architecture was designed with exactly this kind of compositing in mind, not as a workaround bolted on after the fact
- [ ] Mix amount exposed as a `@mod`-eligible control on `BlendState`, wired into `lib/modulation/` the same way any other named parameter is today — no renderer-specific modulation logic needed, since the bus already targets params by name rather than by asset type. **This also means mix amount will be MIDI/gamepad-wireable for free once Phase 4.97 ships**, the same way any other modulatable param is (rev 11)
- [ ] Mask support: an SVG-as-mask source needs to be rendered to an offscreen alpha/luminance texture for GL compositing, or handled via a DOM-level `mask-image`/`clip-path` approach for non-WebGL composites — genuinely open, see §11 decision #6

**Explicit non-goal for v1 of this phase:** video as a blend source. Scoped to image / SVG / shader / p5 sources first, mirroring the same phase-gating discipline that kept the original plan finishable (§1, Non-goals). Video blending is a reasonable post-v1 extension once the compositing pass is proven against cheaper sources.

**Performance budget impact (§9):** a blended pair is two live renderers plus a compositing pass, not one. Count each blended tile pair as **2** against the existing "≤6 concurrent live renderers" budget rather than inventing a second budget category — keeps the existing hard-numbers discipline intact instead of creating a parallel set of numbers to maintain.

**Dependency on Phase 4.95:** functionally works without it — any board asset can already be a blend source — but the "expand the visual moods... with masking SVG shapes" half of the owner's concept specifically wants a populated, purpose-built shape library to mask against. Blending two mood tiles together is useful the day this ships; masking one through a curated shape library is substantially more useful once Phase 4.95 exists first. This is the main reason 4.95 is sequenced ahead of this phase rather than after it.

**Exit:** open the sidecar drawer on a focused tile, select a second tile as a blend source, adjust blend mode and mix amount, right-click mix amount to assign it to an LFO or the live audio input (Phase 4.9), and see the composited result update in real time in the focused view.

**Status check (rev 11):** not started. No change since rev 10.

> **Revision note (rev 14):** build the Blend sidecar as a fifth panel on the Phase 4.98 `FloatablePanel` host (add `'blend'` to `PanelId`, one panel shell, one overlay flag) rather than as a bespoke third drawer — it then gets float/dock and the stack accordion for free. **Budget check needed at kickoff:** a blended pair counts as 2 against `MAX_LIVE_RENDERERS`, which is device-scaled at 3 / 2 / 1 (§9). On a ≤4-core machine that is the entire budget, and on a low-core coarse-pointer device blending cannot run at all. Decide the fallback (for example, gate Blend on a budget of at least 2, or render the second source as a poster) before building.

### Phase 6 — Export & polish (est. 1 week)

- [ ] PNG capture at 1×/2×/4×
- [ ] WebM capture via `MediaRecorder`; offline frame-exact export via `webm-writer`
- [ ] Command palette (`cmdk`)
- [ ] Board sharing via read-only link
- [ ] Empty states, loading skeletons, error boundaries per route
- [ ] Lighthouse pass; bundle audit

**Exit:** export a 10-second 1080p WebM of a modulated shader without dropping frames.

> **Revision note (rev 10):** unchanged in scope, but now sits after Phase 5.5 rather than immediately after Playground. This is arguably an improvement to the original sequencing rationale in §7 Phase 5, point 3 ("Export is most useful once people have made something worth exporting") — a blended/masked composite is exactly the kind of thing worth exporting at 4×, more so than either source tile alone.

### Phase 6.25 — Mobile Companion Controller (DEFERRED, rev 14; depends on the deferred Live Session Bus)

> **Deferred (rev 14):** parked until the Live Session Bus is approved, which itself waits on demand for live-drag mirroring or a phone controller. Re-entry triggers: integration plan §6. The design below is retained unchanged.

**Purpose:** let an authenticated phone or tablet become a focused wireless touch controller for the mood tile running on a desktop/laptop. Same Wi-Fi improves locality but is optional and never establishes trust. The desktop workspace remains authoritative; mobile sends typed commands and receives canonical acknowledgements/state through the 4.98B Live Session Bus.

- [ ] **6.25.0 — Explicit pairing:** desktop QR code plus six-character fallback, same-account authentication, mobile session picker, explicit desktop approval, short-lived role-scoped controller grant, revoke and inactivity expiry
- [ ] **6.25.1 — Controller shell:** connection/latency status, current tile, reconnect/exit, **Follow Focus** and **Lock to Tile**; one writable mobile controller in v1
- [ ] **6.25.2 — Parameters:** schema-generated touch controls, optimistic local response followed by canonical acknowledgement, clear separation between editable base value and live effective/modulated value
- [ ] **6.25.3 — Modulate and VFX:** source, amount, smoothing, routing, slots, bypass, wet/dry, and effect parameters; coalesced continuous gestures with exact final-value flush
- [ ] **6.25.4 — Mobile reliability:** lightweight poster/low-rate preview instead of full rendering by default, progressive Screen Wake Lock, background/foreground recovery, orientation/safe-area handling, reduced motion, reconnect and revocation tests

**Security boundary:** the controller cannot create output links, inspect source code, delete assets, change account settings, or submit arbitrary store/database patches. Every command is checked against role, session, board-item target, sequence, command kind, and payload schema.

**Deferred enhancement:** touch XY pads for Modulate and the VFX rack are approved but intentionally excluded from the first controller sprint. Build them after Phase 4.98 (Floating Sidecar Panels) ships — they no longer wait on a floating output tile — then reuse one normalized XY command contract across desktop and mobile.

**Exit:** an explicitly paired mobile device controls Parameters, Modulate, and VFX for the followed or locked tile; desktop, phone, OBS, and other outputs converge to one canonical revision after normal interaction and reconnect.

### Phase 6.5 — Live Output & External Display (DEFERRED, rev 14; re-scoped)

> **Re-scoped (rev 14):** the near-term slices are **6.5A Stage page + pop-out window** and **6.5B OBS Browser Source link** (integration plan §4–5). The in-app floating *panel* work originally listed as 6.5.1 moved forward to **Phase 4.98**. The items below are the original longer-range scope and stay parked until their re-entry triggers (integration plan §6).

**Purpose:** turn the secure output foundation into a coherent multi-window and multi-display workflow. Browser windows can be opened and resized by the user and moved across monitors by the operating system. The app may request a popup from a direct user gesture, but browsers retain control over popup permission and final placement. Native NDI output is outside the browser-only scope; NDI workflows continue through OBS or another capture/bridge application.

- [ ] **6.5.0 — Shared host contract:** make `OutputSurface` the sole visual host used by the OBS route, in-app floating panel, popup, and fullscreen modes
- [ ] **6.5.1 — In-app floating output tile:** *(rev 14: the floating sidecar/drawer half moved to Phase 4.98.)* draggable and resizable inside the browser viewport with aspect lock, snap guides, remembered geometry, and keyboard alternatives — deferred with Live Output
- [ ] **Post-4.98 — Touch XY performance surfaces (unblocked by Phase 4.98, rev 14):** reusable XY pads for Modulate and VFX on desktop and mobile, with axis assignment, reset/center, pickup/takeover, final-value flush, accessible numeric alternatives, and optional control pinning
- [ ] **6.5.2 — Popup window:** user-gesture `window.open`, clear popup-blocked recovery, renderer-only chrome, user-resizable window, and synchronized state through the 4.98B transport rather than `BroadcastChannel` alone
- [ ] **6.5.3 — Fullscreen and multi-display:** Fullscreen API plus progressive enhancement with the Window Management API where permission and browser support exist; always retain manual placement and normal fullscreen fallback
- [ ] **6.5.4 — External workflow presets:** OBS resolution/aspect presets, transparent/opaque background, `cover`/`contain`, quality/FPS choices, safe-area test frame, and copyable setup guidance
- [ ] **6.5.5 — Reliability and accessibility:** context-loss recovery, display disconnect handling, geometry reset, focus management, reduced motion, keyboard navigation, and long-session soak
- [ ] **6.5.6 — Optional Native GPU Output Bridge:** only if validated demand or profiling justifies native maintenance; signed Windows Spout2 and macOS Syphon senders consume the same `OutputProjection` and Live Session state while Browser Source remains the universal baseline

**Exit:** the same board item can move between in-app float, popup, fullscreen/external display, and OBS output without changing its visual contract or exposing editor controls. Each surface restores useful state after reload or disconnect and degrades clearly when browser permissions or display APIs are unavailable.

> **Sequencing note (rev 14):** everything in Phase 6.25 and 6.5 is deferred. When resumed, reuse one renderer/projection contract (the Stage page) across pop-out and OBS, and add the Live Session Bus only if live-drag mirroring or the mobile controller is approved. Do not build mobile-, popup-, or native-bridge-only rendering/messaging paths. Spout2/Syphon remains optional and must pass a measured demand/performance gate before implementation.

---

## 8. Seed library

Twenty hand-authored assets were originally planned: 10 GLSL shaders and 10 p5.js sketches. Image and video assets are uploaded manually by the owner.

> **Revision note (rev 6):** now at 29 shaders / 34 sketches, 63 total. The Shader set / Sketch set tables below are still the original 20-asset planning set only; the ~43 assets added since aren't fully itemized here, except the 13 from the most recent batch (see "Assets added in the rev 6 batch" below), since that batch's authoring conventions are documented in full for the first time in this revision. Worth backfilling the rest if this doc is going to keep being the source of truth for what the seed set actually exercises.

> **Revision note (rev 10):** this section describes the **board mood-tile seed library** specifically — the corpus that makes the inspector and renderer contract verifiable (below). It's a distinct thing from the new **graphic asset library** introduced in §7 Phase 4.95, which is a curated set of static SVG/PNG shapes meant for masking and blending, not live-parameter tiles. Both use the same underlying ingest pipeline (`scripts/seed.ts`) but are conceptually and, in the data model, practically separate collections — don't conflate "seed" (this section) with "Media library" (§7 Phase 4.95) when reading either.

> **Revision note (rev 11):** library has grown again, 65 (rev 7) → **90 assets**. The exact current shader/sketch split isn't broken out here yet — same backfill debt flagged at rev 6 still applies, now compounded by another growth pass. Worth doing a proper inventory pass (slug, type, concept, one-line control-kind summary, per the format already established for the rev 6 batch below) the next time this doc gets a substantive content-side revision, so §8 stays trustworthy as the actual source of truth rather than drifting further behind the real count.

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

### Uniform annotation syntax & control mapping (documented in full, rev 6)

Not previously written down anywhere outside `lib/gl/parse-uniforms.ts` itself — the gap that caused the rev 6 batch's first draft to invent a different, non-functional syntax. Real syntax, confirmed against the parser and the existing `kaleidoscope-wire.frag` / `mandelbrot.frag` assets:

```glsl
uniform float u_density;   // @label(Density) @range(1, 64) @default(12) @log
uniform vec3  u_tint;      // @label(Tint) @color @default(0.0, 0.83, 1.0)
uniform int   u_mode;      // @label(Mode) @select(Grid=0 | Halftone=1 | Dither=2) @default(0)
uniform vec2  u_center;    // @label(Centre) @range(-1, 1) @default(0.0, 0.0) @group(Composition)
uniform bool  u_invert;    // @label(Invert) @default(true)
uniform sampler2D u_src;   // @label(Source)
```

| Tag | Meaning |
|---|---|
| `@label(Text)` | display name |
| `@group(Text)` | drawer section |
| `@hint(Text)` | help text |
| `@unit(px)` | suffix on the numeric readout |
| `@range(min, max)` | numeric bounds |
| `@default(a[, b, c])` | initial value |
| `@step(n)` | slider increment |
| `@select(A=0 \| B=1)` | dropdown — only valid on `int`/`float`/`uint` |
| `@color` | force vec3/vec4 to a color picker |
| `@log` | logarithmic slider |
| `@advanced` | hide behind the Advanced disclosure |
| `@hidden` | parse but don't expose a control |
| `@mod` / `@nomod` | force modulation eligibility on/off |

**GLSL type → control kind:**

| GLSL type | Control kind | Note |
|---|---|---|
| `float` | slider | |
| `int` / `uint` | stepper | **Not `float`** — declaring a stepper-intended param as `float` silently becomes a slider instead |
| `bool` | toggle | |
| `vec2` | xy | |
| `vec3` | color or vec3 | color if the name matches `/color\|colour\|tint\|rgb\|albedo\|hue\|palette\|ink\|paint/i` or `@color` is given, else a raw 3-axis control |
| `vec4` | color (always, alpha included) | |
| `sampler2D` | texture | supports `allowSelf` for feedback (see `feedback-trails`) |
| `mat*`, `sampler3D`, `samplerCube`, arrays, `bvec*` | unsupported | parser warns and skips |

**Reserved uniforms** (`DEFAULT_RESERVED` — host-driven, never annotate, never name-collide):

```
u_time, u_delta, u_frame, u_resolution, u_mouse, u_pointer, u_seed,
u_pixelRatio, u_aspect, u_hasSource, u_prevFrame, u_backbuffer,
u_audio, u_audioTexture, u_bass, u_mid, u_high, u_rms, u_fft,
iTime, iTimeDelta, iFrame, iResolution, iMouse, iDate,
iChannel0, iChannel1, iChannel2, iChannel3, iChannelTime,
time, resolution, mouse
```

A control-annotated uniform that collides with one of these is silently swallowed at runtime with no error surfaced anywhere — this is the Noise Field `u_mid`/`u_high` failure mode already noted in the parser's own source comments. `verify-seed.ts` catches it as a warning; never ignore that warning.

Worth knowing and not previously written down: `u_pointer` and `u_mouse` are already host-fed. A shader gets live pointer/touch position for free — no renderer-contract work required to add pointer-following effects.

**p5 `select` params** need `{label, value}` option objects, not plain strings — `options: ['MOOD', 'FLUX']` fails `verify-seed.ts` with "default X is not among its options" even when the default is visibly in the array, because there's no `.value` for the check to match against on a bare string:

```js
phrase: { kind: 'select', options: [
  { label: 'Mood', value: 'MOOD' },
  { label: 'Flux', value: 'FLUX' },
], default: 'FLUX' }
```

**`manifest.json` schema, corrected** — the `# title, tags, poster hints, default params` comment in the directory tree above (§8, "Where they live") is inaccurate. The real shape:

```json
{
  "slug": "digital-matrix",
  "type": "shader",
  "file": "shaders/digital-matrix.frag",
  "title": "Digital Matrix",
  "tags": ["glyph", "columns", "generative"]
}
```

`type` is `"shader"` or `"p5"` — not `"sketch"`. `file` is relative to `seed/`. There is no `posterHint` or `defaultParams` field; posters are generated at ingest, not manifest-declared.

### Assets added in the rev 6 batch

| Slug | Type | Concept |
|---|---|---|
| `digital-matrix` | shader | Matrix-style code rain — procedural glyph cells, per-column scroll and character churn |
| `acid-melt` | shader | Domain-warped fbm, kaleidoscope fold, continuous hue rotation |
| `hue-vortex` | shader | Spiral hue rotation with banded, glow-like radial trails |
| `liquid-glass` | shader | Self-animating metaball blob refracted through a glass surface, fractal reflections via domain fold |
| `gravity-lens-ascii` | shader | Procedural-glyph starfield, gravitationally lensed around a moving singularity |
| `language-decay` | shader | Time-varying fbm banding read as alien glyphs eroding and reforming |
| `wound-thread` | shader | Branching SDF vein/thread growth, slow heartbeat-like pulse |
| `orbit-debris` | shader | Raymarched tumbling box fragments in slow orbital decay |
| `type-wave` | p5 | Kinetic typography — text baseline distorted along an animated sine/noise field |
| `glyph-swarm` | p5 | Particle swarm that scatters and reforms into a word, pointer-disturbed |
| `cursor-ripple` | p5 | Expanding ripple rings following pointer/touch |
| `chorus-of-eyes` | p5 | Field of eyes tracking the pointer, blinking asynchronously |
| `static-choir` | p5 | CRT static bands merged with an LFO-driven abstract waveform |

### Shader set (original 10 — see revision note above for the full 90)

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

### Sketch set (original 10 — see revision note above for the full 90)

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
| 4.7 | Seed set reaches 65 — two new pointer-driven p5 tiles, nine reworked on user feedback |
| 4.95 | A second, separate library — static graphic assets for masking/blending, not live-parameter tiles — is seeded through the same pipeline; see §7 |
| — | Library reaches **90 assets** as of rev 11; full inventory backfill still owed (see rev 11 revision note above) |
| 4.99 | Library reaches **100 assets** — Shapeshift (§7 Phase 4.99) ships as tile #100, its own control schema (49 controls) manifest-verified alongside the existing 99; see `docs/SHAPESHIFT_TILE_100_CONCEPT.md` |

---

## 9. Performance budget

Hard numbers. Treat a regression as a build failure.

| Metric | Budget |
|---|---|
| Concurrent live renderers | Device-scaled: **3** (desktop, >4 cores) · **2** (≤4 cores or coarse pointer) · **1** (coarse pointer and ≤4 cores) — `MAX_LIVE_RENDERERS` / `detectRendererBudget()` in `stores/playbackStore.ts` (earlier plan text said ≤ 6) |
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

> **Revision note (rev 10):** Phase 5.5's blend compositing doesn't get its own budget line. A blended tile pair counts as **2** against "Concurrent live renderers ≤ 6" — two source renderers plus one compositing pass sharing the existing single WebGL2 context — rather than introducing a second, parallel set of numbers to keep in sync with this one.

> **Revision note (rev 11):** Phase 4.97's MIDI/gamepad control-surface polling likewise doesn't get its own budget line, but for the opposite reason — it's explicitly **not** allowed to run inside the shared renderer tick loop at all (see §7 Phase 4.97 and `MIDI_CONTROL_SURFACE_CONCEPT.md` §9), so it never competes against the ≤6 renderer budget in the first place. It gets its own small, isolated `requestAnimationFrame` loop instead. Worth stating explicitly here so it isn't later folded into the renderer count by mistake.

> **Revision note (rev 14):** the "≤ 6" figure in the rev 10 note above and in §12 predates the shipped, device-scaled budget (3 / 2 / 1). Treat the code as authoritative. The "blended pair counts as 2" rule stands, but see the Phase 5.5 rev 14 note for what it means at a budget of 2 or 1.

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

> **Note for Phase 4.95 (rev 10):** the graphic asset library's own preview grid should hold this same discipline — flush `--radius: 3px` cards, no drop shadows to fake depth on what are, after all, mostly monochrome vector shapes. The temptation with an icon/shape library is to add card elevation to help shapes read against a black background; resist it and let the accent-on-selection rule do that job instead, consistent with the rest of the app.

> **Note for Phase 4.97 (rev 11):** the 8-slot MIDI/gamepad pad grid (`MIDI_CONTROL_SURFACE_CONCEPT.md` §7) should follow the same discipline as the Modulation panel it lives inside — mono-labelled rows, accent reserved for an actively-routed slot's indicator dot (the existing Modulation panel already does exactly this, per the screenshot reference: a filled cyan dot marks routed rows, an empty outline dot marks unrouted ones). No new visual language needed; the pattern to extend already exists on screen today.

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
| 6 | SVG mask rendering | **RESOLVED (rev 20, by Phase 4.99):** offscreen GL texture. `lib/shape-source/` builds exactly this — SVG/PNG/JPG/text → signed-distance-field GL texture — for Shapeshift, and Phase 5.5 reuses the same module as its mask source rather than building a second, DOM-based path | Phase 5.5 |
| 7 | Graphic-pack commerce timing | Add `packId`/`isPremium` now, unbuilt commerce **vs** wait until commerce is actually scoped | Phase 4.95 data model |
| 8 *(new, rev 11)* | MIDI pick-parameter targeting scope | **RESOLVED:** focused tile only, v1 | Phase 4.97 |
| 9 *(new, rev 11)* | MIDI/gamepad fan-out (one slot → multiple params) | **RESOLVED:** yes, in v1 — see `MIDI_CONTROL_SURFACE_CONCEPT.md` §5 | Phase 4.97 |
| 10 *(new, rev 12)* | Output identity and bearer security | **RESOLVED:** grant targets `boardItems.id`; store token hash only; raw token appears only at create/rotate; revoke and expiry supported | Phase 4.98A → 6.5B (deferred, rev 14) |
| 11 *(new, rev 12)* | Production synchronization transport | **OPEN:** select after a deployed Vercel spike comparing WebSocket/realtime-backplane behavior and SSE fallback against reconnect, cross-instance, idle, fan-out, and cost requirements | Phase 4.98B (parked, rev 14) |
| 12 *(new, rev 13)* | Mobile-controller transport and trust | **RESOLVED DIRECTION:** selected server-mediated 4.98B transport is baseline; same Wi-Fi is optional and never grants trust; WebRTC DataChannel is a future low-latency adapter with signaling/relay fallback, not a v1 dependency | Phase 6.25 (deferred, rev 14) |
| 13 *(new, rev 13)* | Spout2/Syphon versus Browser Source | **RESOLVED DIRECTION:** Browser Source remains universal; native bridge is additive and begins only after measured performance limits or validated professional GPU-sharing demand | Phase 6.5.6 (parked, rev 14) |
| 14 *(new, rev 14)* | Floating-panel mechanism | **RESOLVED:** float in place via `position: fixed` on the panel's existing wrapper (no portal, no remount) so panel-local state survives; portal plus lifted state is the documented fallback if the P0 spike fails on any browser | Phase 4.98 |

Recommended defaults if you want to move now: **1** shared context, **2** single-user, **3** bundled, **4** WebM only, **5** deferred, **6** leaning GL texture for consistency with the rest of the compositing pipeline — everything else in Phase 5.5 already lives inside the shared WebGL2 context, and a second, DOM-based masking path is one more thing to keep behaviorally consistent with the GL one (blend modes, mix amount, modulation) for no clear benefit; worth a quick prototype of both before fully committing, since native SVG alpha via `clip-path` is genuinely simpler if it turns out to be good enough, **7** flag now — it's free today and expensive to retrofit, matching the schema-drift risk already tracked in §12.

> All of items 1–5 are resolved in practice as of Phase 2–4 shipping (the recommended defaults above are what's actually running) — left unmarked rather than retroactively checked off, since this table's value going forward is mainly as a record of what was decided and why. Item 6 is resolved as of rev 20 (Phase 4.99) — GL texture, matching the recommended default below. Item 7 remains open but leaning toward "flag now." Items 8–9 were resolved in rev 11 (see `MIDI_CONTROL_SURFACE_CONCEPT.md` §2). Item 10 is resolved by the Phase 4.98 security contract. Item 11 intentionally remains open until the deployment spike produces measurements; transport choice should not be guessed from framework support alone. Items 12–13 settle the architectural direction without prematurely selecting a WebRTC implementation or authorizing native bridge work.

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
| Hand-authored SVG packs carry inconsistent viewBox/fill conventions | High | Low | `verify-media-assets.ts` validation pass at ingest (§7 Phase 4.95); `currentColor` normalization before first tint/mask use |
| Blend compositing doubles live-renderer cost per blended pair | Medium | Medium | Count each blended pair as 2 against the existing ≤6 renderer budget (§9); no video blend sources in v1 |
| ~~`getTrackFrequencyData()` runs outside the shared tick loop's per-card `try/catch` (§7 Phase 4.9)~~ | — | — | **Resolved (verified rev 14):** wrapped by `safeGetTrackFrequencyData()` in `lib/render/pool.ts` |
| *(new, rev 11)* Web MIDI browser support is inconsistent, especially iOS/Safari | High (platform-driven, not fixable) | Medium | Explicit feature detection in Settings > MIDI & Controllers with a clear "not available in this browser" state, rather than a silent no-op (§7 Phase 4.97) |
| *(new, rev 11)* Device Profiles rely on MIDI device **name** matching, since Web MIDI has no stable ID across replug on every OS | Low | Low | Documented as a known limitation with a one-line caveat in the Settings UI for the "two identical controllers" edge case, rather than attempting a more complex identity scheme for v1 |
| *(new, rev 11)* Gamepad polling requires its own render loop, separate from the shared GL tick loop, or it repeats the exact unguarded-call pattern already flagged above for `getTrackFrequencyData()` | Medium (real risk if not deliberately avoided) | High | Isolated, defensively-wrapped `requestAnimationFrame` loop for control-surface polling, explicitly decoupled from `context-pool.ts` and the ≤6 renderer budget (§9, §7 Phase 4.97) |
| *(new, rev 12)* OBS bearer URL leaks through logs, analytics, history, screenshots, or copied support data | Medium | High | High-entropy one-time token; hash at rest; redact query strings and authorization values; `Referrer-Policy: no-referrer`; no third-party scripts on output route; rotate/revoke controls in VCapture |
| *(new, rev 12)* Treating shader/p5 source as a secret breaks the renderer contract or creates false security claims | Medium | Medium | Include only the executable source required by the authorized projection; document that browser-delivered source is inspectable; exclude identity, inventory, editor state, and all write capabilities |
| *(new, rev 12)* Granting an asset instead of a board item loses per-tile overrides or exposes the wrong visual | High if modeled incorrectly | High | Bind grants to `boardItems.id`; resolve params, modulation, VFX, sound policy, and fit/quality into an allowlisted projection |
| *(new, rev 12)* Same-browser messaging is mistaken for OBS synchronization | High | High | Do not rely on `BroadcastChannel` for OBS; use the selected server-mediated transport with snapshots, sequence numbers, reconnect, and cross-instance tests |
| *(new, rev 12)* OBS, popup, fullscreen, and in-app float grow separate render implementations | Medium | High | One `OutputSurface` and one `OutputProjection` contract across 4.98A, 4.98B, and 6.5; add contract tests for every supported asset type |
| *(new, rev 12)* A valid output token is mistaken for private media delivery while current Vercel Blob objects remain public | Medium | High | State the current boundary accurately; keep grant APIs private; audit poster/media URLs; move sensitive media to private storage or signed delivery before promising private assets |
| *(new, rev 13)* Same-account devices connect silently or the phone controls the wrong desktop session | Medium | High | Explicit session selection, QR/code pairing, desktop approval, short-lived scoped controller grant, visible host/session identity, immediate revoke |
| *(new, rev 13)* Mobile gestures fight modulation or replay stale input after reconnect | High if untreated | Medium | Separate base and effective values; sequence/acknowledge typed commands; coalesce gestures; flush final value; discard stale queued gestures after disconnect |
| *(new, rev 13)* Full renderer on mobile causes heat, battery drain, context loss, and poor touch latency | High | Medium | Poster/low-rate lightweight preview by default; measure thermals and input latency; make full preview optional and capability-gated |
| *(new, rev 13)* Mobile, MIDI, Inspector, and future XY pads create separate mutation paths | Medium | High | One normalized control-command layer targeting the existing schema/store/pool path; inputs differ but canonical state mutation does not |
| *(new, rev 13)* Native Spout2/Syphon bridge creates an OS-specific support burden before demand exists | Medium | High | Keep Browser Source primary; require measured gate; reuse output/session contracts; separately scope installers, signing/notarization, updates, GPU/driver and OBS compatibility |
| *(new, rev 14)* `position: fixed` inside the sidecar stack behaves differently on Safari or Firefox, or an ancestor gains `transform`/`filter`/`contain` and traps it | Low | Medium | P0 spike on Chrome, Safari, and Firefox before building; comment at the CSS; portal fallback documented |
| *(new, rev 14)* A drag released over the scrim closes the whole focused overlay (scrim `onClick`) | High if unhandled | High | Pointer capture plus a one-shot capture-phase click suppressor; explicit QA case |
| *(new, rev 14)* The accordion surprises people who want several panels expanded | Medium | Low | Floating panels are exempt; Shift-click expands additively; tooltip mentions it |
| *(new, rev 14)* A floating panel is lost off-screen after a monitor or viewport change | Medium | Medium | Clamp on hydrate and on resize; *Dock all panels* in the header overflow menu |
| *(new, rev 14)* Floating panels grow into a docking framework | Medium | Medium | Explicit non-goals; docking library parked with a re-entry trigger |
| *(new, rev 14)* Modulation's collapse hides only its signal list, not its tabs or Controllers view | High (present today) | Medium | Fixed in Phase 4.98 P3; acceptance on both tabs |

> Rows tagged *(new, rev 12)* and *(new, rev 13)* belong to the Live Output work deferred in rev 14. They stay registered so they are not lost when that work resumes.

---

## 13. Definition of done (per phase)

- [ ] Strict TypeScript, no `any` in the diff
- [ ] Keyboard-navigable with visible focus
- [ ] `prefers-reduced-motion` respected
- [ ] Responsive to 375px
- [ ] Error boundary on the route
- [ ] No console warnings in a clean session
- [ ] Performance budget re-measured, not assumed

**Additional gates for Phase 4.98 (Floating Sidecar Panels):**

- [x] The stack path is behavior-identical when nothing is floated; the tile never shifts when panels float, dock, or collapse *(Chromium)*
- [x] Accordion verified on all four panels, including Modulation's Signals and Controllers tabs; floating panels exempt; Shift-click additive *(Chromium)*
- [x] A drag released over the scrim, the tile, or the Inspector edge never closes the overlay *(Chromium)*
- [x] Persisted layout validated by `npm run verify:panel-layout`; corrupt storage falls back to defaults; floating panels re-clamp on resize
- [x] Keyboard-movable and keyboard-dockable with visible focus; no new animation *(keyboard movement and focus retention verified in Chromium; the new buttons reuse the existing `IconButton` focus styling)*
- [x] Verified on Chrome, Safari, and Firefox via a preview deployment; mobile and kill-switch-off unchanged *(Chromium automated; Safari and Firefox by the owner on the preview; mobile and kill-switch runs automated)*
- [x] Focused-tile frame rate during drag is within noise of the pre-change baseline *(measured as a controlled comparison in the build sandbox; on real hardware, owner-observed rather than instrumented)*
- [x] The diff touches no pool, renderer, sandbox, API route, schema, or security-header code

**Additional gates for the deferred Live Output work (6.5A / 6.5B / session bus / 6.25) — apply when that work resumes (rev 14):**

- [ ] Output page renders the visual only; automated checks find no app navigation, tile toolbar, Inspector, setup, or mutation controls
- [ ] Grant creation, rotation, revocation, expiry, and unauthorized access are integration-tested; raw bearer tokens are never persisted or logged
- [ ] Shader, p5, image, SVG, and video fixtures pass the `OutputProjection` contract at common OBS aspect ratios and after resize/context loss
- [ ] Synchronization tests cover snapshot-first load, ordering, duplicate/stale events, reconnect, cross-instance delivery, owner lease/takeover, and token revocation during a live session
- [ ] Role tests prove output/display clients are read-only and mobile-controller clients can issue only allowlisted commands to the explicitly paired session/item
- [ ] Mobile tests cover QR/code pairing, approval, revoke, Follow Focus, Lock to Tile, base/effective value separation, final-value convergence, background/foreground, wake-lock fallback, and one-controller contention policy
- [ ] Long-running OBS and popup sessions stay within measured CPU/GPU/memory and reconnect budgets
- [ ] Phase 6.5 fallback behavior is usable when popups, fullscreen, or multi-display permissions are denied or unsupported
- [ ] Touch XY pads do not begin until Phase 4.98 (Floating Sidecar Panels) has shipped
- [ ] Spout2/Syphon work does not begin without a documented demand/performance decision and native release/support scope

---

## 14. Post-v1 backlog

Ordered by leverage, not by appeal.

1. **Board canvas mode** — free-position infinite canvas alongside the grid. Grid browses; canvas composes. *(Worth revisiting once Phase 5.5 ships — freeform-positioned, overlapping tiles in canvas mode is a complementary, lighter-weight alternative to drawer-based blending for some use cases, not a replacement for it.)*
2. ~~Blend layers~~ — **promoted to §7 Phase 5.5 (rev 10)**, no longer a backlog item.
3. **Local-first** — IndexedDB cache with optimistic writes; the board works offline and feels instant.
4. ~~MIDI in — WebMIDI mapped onto the modulation bus. Nearly free given the control-schema abstraction.~~ — **promoted to §7 Phase 4.97 (rev 11)**, fully scoped in `MIDI_CONTROL_SURFACE_CONCEPT.md`, no longer a backlog item. The original one-line entry undersold it slightly — it turned out to need one genuinely new binding concept (discrete triggers) alongside the "nearly free" continuous-modulation reuse it correctly predicted.
5. **Timeline / sequencer** — sequence board items into a playable set with crossfades. This is the point where the tool becomes a VJ rig. *(Worth another look once Phase 4.97 ships (rev 11) — board/session-level "Show Control," flagged as explicitly out-of-scope for Phase 4.97 v1, is a close cousin of this item and the two may end up sharing groundwork.)*
6. **Version history for code assets** — cheap, since sources are already text rows.
7. **Media playback controls for uploaded image/video assets** — LUTs, auto hue-cycling, playback speed. A natural extension of the `BASE_CONTROLS`-plus-type-specific-extras concept already named in §5, scoped entirely to the upload pipeline. Considered and deliberately deferred during the Phase 5 readiness review (rev 7): pairs more naturally with Phase 6's export/color work than with anything Playground needs. Worth a second look once Phase 4.95 ships — a Media page full of static shapes is also a natural home for basic hue/LUT controls on imported video, if that phase's scope has room once its core exit criterion is met.
8. *(new, rev 11)* **Board/session-level "Show Control"** — cross-tile MIDI/gamepad mapping and scene switching (blackout, crossfade), explicitly scoped out of Phase 4.97 v1 as a different data shape from per-tile binding. See `MIDI_CONTROL_SURFACE_CONCEPT.md` §12.
9. *(new, rev 11)* **Webcam hand-tracking as a control-surface source** — the owner's own stated future direction, following MIDI/gamepad. `lib/control-surface/`'s `ControlSurfaceSource` union is deliberately designed to accommodate a `webcam-gesture` variant later without rework — see `MIDI_CONTROL_SURFACE_CONCEPT.md` §12. Not scoped, not estimated; flagged here so it isn't forgotten once Phase 4.97 ships.
10. *(new, rev 14)* **Live Output — Stage page + pop-out window, then OBS Browser Source link** — deferred from the former Phase 4.98A/6.5; full design in `VISUAL_MOOD_LAB_FLOATING_PANELS_INTEGRATION_PLAN.md` §4–5. OBS Window/Display Capture works today.
11. *(new, rev 14)* **Live Session Bus, Mobile Companion Controller, Spout2/Syphon bridge, multi-display placement, shader transparency, docking library / layout presets** — parked with re-entry triggers in the same document, §6.

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

### Data layer — seed/board sync (rev 6 addition)

- **New library assets invisible on existing accounts' boards after a seed run:** `assets` and `board_items` are two separate tables (see `lib/data/assets.ts`'s own header comment). `npm run seed` / `/api/seed` only upserts into `assets`, owned by the fixed `LIBRARY_OWNER_ID`. A brand-new account's board clones the full library into `board_items` exactly once, on its first `getOrCreateDefaultBoard()` call — an account that already existed before a seed batch landed never re-triggers that clone, so newly seeded assets are real, correctly-seeded rows that are simply never linked into that account's board. Confirmed before touching any code: `SELECT count(*) FROM assets` matched the new total (63); `SELECT count(*) FROM board_items WHERE board_id = '<affected board>'` was still stuck at the old total (50). **Fix:** `getOrCreateDefaultBoard` now diffs the library's item set against the current board's item set on every call — rather than only backfilling when the board has zero items — and inserts whatever's missing. Since this function already runs on every board page load, an existing board now self-heals to match the library the next time that account simply opens the app, with no manual step required going forward. A one-time manual backfill (`INSERT ... ON CONFLICT DO NOTHING` copying every row from `board_items` where `board_id = 'default:library'` into every other board missing it) was used to unblock already-affected accounts immediately, ahead of the code fix reaching production — worth keeping as a documented fallback if the self-heal path is ever found not to fire (e.g. a board reached through some path that bypasses `getOrCreateDefaultBoard`).

### Sandbox / focused-view resize (rev 7 addition)

- **Canvas-size-dependent precomputed data going stale specifically in Fullscreen, while other resizes (opening/closing the Inspector drawer) worked correctly:** `p.windowResized` — the only place three sketches (Glyph Swarm, Wound Thread, Chorus of Eyes) rebuilt their canvas-size-dependent point clouds or layouts — only fires in response to a genuine browser `window resize` event. These sketches run inside the sandboxed iframe (`lib/sandbox/`), and Fullscreen evidently resizes that iframe's canvas through the host/sandbox postMessage bridge directly rather than triggering a native resize event inside the iframe itself — so `p.windowResized` never ran for that specific transition. The affected sketches kept rendering target positions computed for the old, smaller canvas, stretched across the new, much larger one, which is why it looked like the shape had come completely undone rather than just being slightly off. **Fix:** all three sketches now poll `p.width`/`p.height` once per frame and rebuild whenever the values have actually changed, instead of depending on the callback firing at all — correct regardless of which mechanism changed the canvas size. `p.windowResized` is kept only as a redundant fast path for genuine window resizes; it's no longer load-bearing.

### Sketch defaults

- **Transform Shape / Orbit Sphere "Solid" render mode effectively invisible:** both sketches defaulted `fillColor` to near-black (`~0.05` per channel) combined with dim ambient light (0.12–0.15), rendering solid faces indistinguishable from the pure-black canvas background. Raised both sketches' default fill brightness and ambient light. Transform Shape's fill default has since been tuned twice more for contrast against its cyan edge default — most recently to magenta (`#FB00FF`) — since a merely-visible fill still read as a dim variant of the same look rather than a genuinely different render mode.
- **Transform Shape wireframe visibly clipped/cut off:** likely cause is the shape's rotated silhouette (cylinder/cone have real axial extent) exceeding the camera's field of view at the default size of `0.51 × canvas`, since the sketch never explicitly configures the camera and relies on p5's auto-computed perspective. Addressed with a size safety margin (`× 0.82`) rather than restructuring the camera, since the exact mechanism (frustum framing vs. near-plane clipping) wasn't confirmed interactively — flagged for a closer look if the margin doesn't fully resolve it.

### Audio / modulation (rev 10 addition)

- **Uploading a track blacked out every live tile on the board, not just the one with the track:** buffer-size mismatch between `track.ts`'s `waveAnalyser` and `meter.ts`'s existing analyser. Both now share `fftSize = 256`. Fix confirmed from source. See §7 Phase 4.9.
- **Flagged in rev 10, resolved (verified rev 14):** `getTrackFrequencyData()` ran inside the shared `tick()` loop (in `lib/render/pool.ts`, not `lib/gl/context-pool.ts` as this entry originally said) outside the per-card `try/catch`. It is now wrapped by `safeGetTrackFrequencyData()`; a throw is logged once per card and treated as no track data for that frame.

### Modulation stability (new, rev 11 addition)

- **"Erratic jump on Play/toggle" across multiple report threads:** three compounding causes, all fixed in the same pass — a stale `BandAutoGain` baseline surviving across playback restarts (`track.ts`), routings applying at full amount instantly on activation instead of ramping in (`bus.ts`), and the smoothing filter drifting with frame rate instead of being `dt`-normalized (`bus.ts`). Full detail in §7 Phase 4.

- **Turbulent Flow's Morph Speed unresponsive to modulation — traced to a systemic bug, not a one-tile issue:** `lib/render/pool.ts`'s `entry.baseParams` was built from saved `asset.params` alone, with no schema-defaults merge, so any control added or re-tuned after a tile's params were last saved had no `baseParams` entry and silently fell through `applyModulation()`'s undefined-base guard — with zero error surfaced anywhere. Any tile whose schema changed after its params were last saved could plausibly have hit this before the fix. Full detail in §7 Phase 4.
- **Motion Blur and other `audio.*`/`mic.*` modulation targets reading "stuck" in a narrow band (0.35–0.39):** `BandAutoGain.apply()`'s ratio-to-recent-peak normalization mathematically pins near 1.0 for sustained/compressed signals — rewritten to baseline-deviation. Now a standing project principle, not a one-off fix.

### Audio lifecycle — mobile stabilization (new, rev 11 addition)

- **Track playback icon/state not surviving a mobile background/foreground cycle, and playback occasionally not resuming after a full OS-level `AudioContext` teardown:** addressed with `attachAudioLifecycleListeners()` (resume on `visibilitychange`/`pageshow`), `attachTrackVisibilityLifecycle()` (auto-pause on background so UI state stays honest), and a full recovery path in `startSourceAt()` (`resetAudioContextForRecovery()` + `rewireTrackGraph()` + one retry). Full detail in §7 Phase 4.9. This closes out the rev 10 status of "core implementation complete... not yet pushed" — it is now pushed and field-hardened.

### Still open

- ~~Press inside the focused view's tile or a sidecar panel, release over the bare scrim → the whole focused view closes~~ — **fixed and SHIPPED (rev 18):** merged to `main` as `f6566f6` on 2026-09-21 (owner-tested on the preview, then merged); the fix commit is `eaa609a` on top of the Phase 4.98 merge `a3cfbe9`. *(Added rev 16; pre-existing, exposed by owner testing of Phase 4.98, not caused by it. Rev 16 additionally claimed this affected slider drags that end outside their panel — that was wrong: `Slider` captures the pointer on press, so a slider drag always completes correctly regardless of where it ends; only presses on plain content — panel text, the tile itself — were affected. Root cause: the browser fires the resulting `click` on the nearest common ancestor of the press and release targets, which is the backdrop, so the existing "click landed on the backdrop" check passed even though neither the press nor the release was actually on it. Same pattern existed in the command palette and the shared `Dialog`; all three now share `lib/ui/backdrop-dismiss.ts` via `useBackdropDismiss`, which requires the press AND the release to both land on the backdrop. Owner-tested on its own preview before merge. See `SPRINT_FLOATING_PANELS.md` §12.)*
- **Mobile "Save snapshot" captures the wrong image** (an error placeholder, not the real captured frame). **Priority raised (rev 5):** originally filed when `MobileFocusedView.tsx` existed but was never mounted anywhere, meaning no one could actually hit this path through the app. As of Phase 4.5, `MobileFocusedView` is wired into `AppShell` and live in production on every phone-width session — this is no longer a theoretical gap in an unreachable component, it's an active bug real users can hit today. Root cause still not investigated; needs `features/board/MobileFocusedView.tsx` and/or the mobile-specific capture call path. **Still open as of rev 11** — not touched this revision. Worth picking up before or alongside Phase 5 given it's now reachable, even though it isn't formally blocking Playground.
- **Sound panel UX debt:** see §7 Phase 4.9.1 in full — not a single bug but a cluster of layout/state issues left behind by shipping track/mic input fast. Diagnosed, not yet coded. **Still open as of rev 11.**
- ~~`getTrackFrequencyData()` unwrapped in the shared tick loop~~ — **resolved (verified rev 14)**; see §12 and §7 Phase 4.9. Still the pattern to avoid repeating in Phase 4.97's control-surface poll loop.
