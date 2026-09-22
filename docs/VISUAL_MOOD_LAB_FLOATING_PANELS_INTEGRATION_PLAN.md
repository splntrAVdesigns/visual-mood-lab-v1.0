# Visual Mood Lab — Floating Sidecar Panels & Deferred Live Output

**Scope:** Phase 4.98 Floating Sidecar Panels (next) · Phase 6.5A Stage page + pop-out (deferred) · Phase 6.5B OBS Browser Source link (deferred) · Parked backlog from the earlier Live Output plan  
**Prepared:** 2026-09-20 (rev 3 of the Live Output integration plan; supersedes rev 2's sequencing)  
**Source baseline reviewed:** `splntrAVdesigns/visual-mood-lab-v1.0` @ `79bdfc0` (`main`)  
**Status:** Design complete; **Slice 1 fully SHIPPED (rev 18)** — merged to `main` as `a3cfbe9`, owner-verified on the Vercel preview in Safari and Firefox. A related pre-existing backdrop-click bug was found, fixed, owner-tested, and merged, merged to `main` as `f6566f6` on 2026-09-21 (owner-tested on the preview, then merged); the fix commit is `eaa609a` on top of the Phase 4.98 merge `a3cfbe9`. Slices 2–3 remain deferred. Sprint and results: `SPRINT_FLOATING_PANELS.md` (§11–12).

---

## 1. Decision and sequencing

The earlier plan (`VISUAL_MOOD_LAB_PHASE_4_98A_4_98B_6_5_INTEGRATION_PLAN.md`, rev 2) led with a secure OBS output route, a realtime session bus, and a mobile controller. A source audit of the current build showed a much smaller route to the same product goals, and the owner chose to lead with the piece that benefits every user of the app long-term: **floating sidecar panels on desktop**. OBS can already be used today through Window/Display Capture (§7), so the output work is deferred rather than urgent.

| New slice | Phase | What | Status | Est. |
|---|---|---|---|---|
| **Slice 1** | **4.98** | Floating Sidecar Panels (desktop) + stack accordion | **Next — sprint organized** | 4–5 days |
| Slice 2 | 6.5A | Stage page + pop-out window | Deferred | 3–4 days |
| Slice 3 | 6.5B | OBS Browser Source link (token) | Deferred | 3–4 days |
| Parked | — | Live Session Bus, mobile controller, native bridge, multi-display, shader transparency, docking library | Parked with re-entry triggers (§6) | — |

### Old → new numbering

| Rev 2 label | Now |
|---|---|
| 4.98A Secure Clean Output | Reduced and renamed **6.5B** (deferred) |
| 4.98B Role-Aware Live Session Bus | **Parked** (only becomes 6.5C if live-drag mirroring in OBS is demanded) |
| 6.25 Mobile Companion Controller | **Parked** (needs the bus) |
| 6.5.0–6.5.5 Live Output & External Display | Reduced to **6.5A** (Stage + pop-out); multi-display placement parked |
| 6.5.6 Native Spout2/Syphon bridge | **Parked**, unchanged gate |
| Touch XY pads ("after floating host") | **Unblocked by Phase 4.98** — the prerequisite is now floating *panels*, not a floating output tile |

### Why this order

1. **Broadest, longest-lived user value.** Every user with more than one sidecar open hits the stack-scrolling problem today. Nothing else in the plan improves the daily editing experience as directly.
2. **Smallest blast radius.** No new tables, routes, tokens, or security surface. Persistence is a validated `localStorage` key. Renderers, the pool, and the sandbox are untouched.
3. **Stability-first.** The stack path stays exactly as it is when nothing is floated; floating is additive. A one-line environment switch turns it off.
4. **It unblocks later work.** The Phase 5.5 Blend sidecar and the deferred XY pads both want a panel that can float; they get it for free.

---

## 2. Verified codebase baseline (audit of `79bdfc0`, 2026-09-20)

### 2.1 Facts that shape Slice 1

- **Panel open state is local.** `features/board/FocusedAssetOverlay.tsx` holds `showCode / showMod / showSound / showVfx / showCapture` as `useState`. An effect keyed on `asset?.itemId` clears all of them, which is why panels close when the person backs out of a tile. `enterFullscreen()` and the `fullscreenchange` handler also clear them.
- **Stack layout.** Sound, VFX, VCapture, and Modulation render inside `.sidecarStack` (`features/features.module.css`): a flex column to the *left* of `.focusPanel`, `width: var(--sidecar-w, …)` with `--sidecar-w: min(20vw, 280px)`, `max-height: 100%`, `overflow-y: auto`. An invisible `.sidecarSpacer` of equal width sits on the right so the tile stays centered. Four `data-mod / data-sound / data-vfx / data-capture` attributes on `.focusScrim` switch the width variable and gap on.
- **Identical panel shells.** `SoundPanel`, `VfxPanel`, `CapturePanel` (in `features/board/`), and `ModulationPanel` each render `<aside className={s.modPanel} data-collapsed onClick={stopPropagation}>` containing `<header className={s.codeHeader}>` (chevron, title, meta, close) and a body. Each keeps `const [collapsed, setCollapsed] = useState(false)` locally, and each has an `embedded` mode (used by the mobile sheet) that returns only the body.
- **Collapse gap in Modulation.** `.modPanel[data-collapsed='true']` hides `.modPanelList`, which covers Sound, VFX, and VCapture. Modulation's desktop body (`ui.desktopBody`: the SIGNALS / CONTROLLERS tabs plus the Controllers view) is **not** hidden by that rule, so a collapsed Modulation still shows its tabs (visible in the owner's screenshot) and never collapses at all while on the Controllers tab. The accordion cannot work until this is fixed.
- **Modulation holds UI state a remount would lose:** the selected `view` tab and the `expanded` routing row are local `useState`.
- **Scrim click closes the overlay.** `.focusScrim` has `onClick={closeOverlay}`; every panel `aside` stops propagation. A drag that *starts* on a panel header and *releases* over the bare scrim produces a `click` on the common ancestor (the scrim) and would close the whole overlay unless suppressed.
- **Layering tokens.** `.focusScrim` is `position: fixed; z-index: 42`; the Inspector is a fixed right drawer at `--z-drawer: 50` with `--inspector-w: 320px`; `--header-h: 48px`. Floating panels live inside the scrim's stacking context, so the Inspector stays above them by construction.
- **No CSS containing block trap.** The only `container-type` in `features.module.css` is on `.focusPanel` (a *sibling* of the stack). Neither `.sidecarStack` nor `.modPanel` has `transform`, `filter`, `contain`, or `will-change`, so a `position: fixed` child of the stack positions against the viewport.
- **Fullscreen** requests fullscreen on `.focusPanel` only, so the stack (and any floating panels, which are siblings) are hidden by the browser automatically.
- **The command palette is jump-to-asset only** (`CommandPalette.tsx`), so a "Dock all panels" action belongs in the focused header's overflow menu (`HeaderOverflowMenu` already takes an items array).
- **Icon set** (`components/ui/Icon.tsx`) has no float, dock, or move glyphs; three small icons are added.
- **MIDI is already integrated as the Controllers tab inside Modulation** (`ControllerPanel`); MIDI writes go through `inspectorStore.setParam`. It floats together with Modulate.
- **Existing patterns to follow:** `vml:`-prefixed `localStorage` keys with SSR guards and try/catch (`onboardingStore.ts`); `scripts/verify-*.ts` runners exposed as `npm run verify:*`; the global `F`, `[`, Space, and Roll (`R` / `M` / ⌘Z) handlers all skip input, textarea, select, and contenteditable targets, and the only arrow-key handlers in the repo are element-local (`Slider`, the command palette's own input), so arrow-key panel movement on a focused button cannot collide with a global shortcut.

### 2.2 Facts that shape the deferred slices

- **The pool holds one entry per `itemId`** (`lib/render/pool.ts`). `promote()` with a different host tears the renderer down and remounts. The same tile cannot live in two hosts of one page.
- **p5 sandboxes message the host `window`.** `P5Renderer` listens on `window` for `message` and checks `e.source === frame.contentWindow`; the sandbox posts to its parent. An iframe moved into a popup document would post to the popup, not the opener. "Portal the tile into a popup" therefore breaks every p5 tile without renderer changes.
- **The shared GL stage is capped at 1280 px per side** (`STAGE_ABSOLUTE_MAX_DIM` in `lib/gl/context-pool.ts`). The cap was set deliberately after a 2304 px regression — every live card pays a full-surface blit. Fullscreen on large displays is upscaled (~1.5× at 1080p, ~3× at 4K). A standalone page with a single renderer has no grid, so it can use its own higher ceiling; measure first.
- **Renderer budget is device-scaled:** `MAX_LIVE_RENDERERS` is 3 (desktop, >4 cores), 2 (≤4 cores or coarse pointer), or 1 (coarse pointer, ≤4 cores) — not 6 as older plan text said.
- **Server building blocks already exist:** `getBoardItem(itemId, viewerId)` returns a resolved item with overrides; `proxy.ts` protects `/`, `/board`, `/asset`, `/playground`; `lib/security/headers.ts` sets `X-Frame-Options: DENY` everywhere except `/sandbox`; the root layout is chrome-free; `/asset/[id]` is a working deep-link pattern.
- **`getTrackFrequencyData()` is already guarded** (`safeGetTrackFrequencyData()` in `lib/render/pool.ts`; the loop lives in `pool.ts`, not `context-pool.ts` as older plan text said). It is no longer a prerequisite.
- **Phase 4.97 code is present through sub-phase 4.97G** (`lib/control-surface/` MIDI + gamepad runtimes, learn, session boundary; `features/controllers/`). The plan's older "not started" status was stale.

---

## 3. Slice 1 — Phase 4.98 Floating Sidecar Panels (desktop)

### 3.1 Goals and non-goals

**Goals**

1. A person can detach any sidecar panel (Sound, VFX, VCapture, Modulation/Controllers) from the stack and place it anywhere in the app frame; panels can be pushed against the left edge as their own area.
2. Stacked panels stop causing runaway scrolling: expanding one collapses the others (accordion).
3. The focused tile never shifts when panels float, dock, or collapse.
4. Panels still close automatically when the person leaves the tile.
5. Zero behavior change on mobile and when nothing is floated.

**Non-goals (v1)**

- Docking framework, tabbed groups, splits, or layout presets.
- Corner-resize (v1.1: width only).
- Code panel floating (it drives the tile's shrink layout via `data-code`; separate design later).
- Touch/mobile floating; popup or external windows; anything OBS-related.
- Reordering panels within the stack.

### 3.2 Behavior specification

1. **Modes.** Each panel is `stack` or `float`. Default `stack`. Mode is remembered per device.
2. **Availability.** Floating exists only when the viewport is ≥ 821 px wide **and** the primary pointer is fine (`(min-width: 821px) and (pointer: fine)`), and the kill switch is on. Otherwise the float control is not rendered and every panel behaves as `stack`.
3. **Ways to float.** (a) Drag a panel header more than 6 px; (b) click the header's *Float panel* button. Either way the panel **detaches anchored by its RIGHT edge and widens leftward** to the 320 px floating width — in the desktop layout the stack sits left of the tile, so growing rightward put the widened panel over the visual (found in owner testing). The button additionally shifts it 32 px left so the detach is visibly identifiable. With no room on the left it pins to the 8 px margin instead of going off-screen. The top edge is unchanged.
4. **Ways to dock.** The *Dock panel* button (same slot as Float), or **Dock all panels** — an inline header button visible only while a panel is floating (the overflow menu only exists below 680 px of panel width, so it cannot be the only route), with the same action also in the overflow menu for the narrow tier. Docking returns the panel to its fixed position in the stack order Sound → VFX → VCapture → Modulation.
5. **Accordion (stack only).** Expanding a stacked panel collapses every *other stacked* panel. Opening a panel from the header toolbar expands it and collapses the other stacked panels. **Shift-click** on the chevron expands without collapsing others. Floating panels are exempt in both directions: they are never auto-collapsed and never auto-collapse others. Docking a panel counts as opening it. Collapsing never has side effects.
6. **Auto-close.** Open/closed flags stay session-only and unchanged: leaving the tile, switching tiles, or entering fullscreen closes every panel, floating or not. Geometry and mode persist; open and collapsed state do not.
7. **Bounds.** A floating panel stays fully inside the viewport horizontally and clear of the Inspector's 320 px column; vertically its header always stays reachable (top ≥ 8 px, top ≤ viewport height − 48 px). Window resize re-clamps every floating panel.
8. **Snap.** Within 12 px of the left edge, top edge, or the Inspector boundary, geometry snaps. Holding **Alt/Option** disables snapping.
9. **Z-order.** Pressing anywhere on a floating panel raises it. Order is session-only.
10. **Height.** A floating panel is as tall as its content up to the space below it; beyond that its own body scrolls (each floating panel scrolls independently, which is the point).
11. **Width.** A panel detaches at least 320 px wide (`FLOAT_DEFAULT_WIDTH`; a floating header carries two more buttons than a stacked one), clamped 240–480 px, persisted. (Corner resize is v1.1.)
12. **Keyboard.** While floating, the header shows a *Move panel* button. Focused, Arrow keys move 16 px, Shift+Arrow 64 px. Float/Dock toggles are reachable by Tab and keep focus (the element does not remount).
13. **Fullscreen.** Unchanged: entering fullscreen closes all panels; floating panels are hidden by the browser regardless because they are siblings of the fullscreened element.
14. **Visual treatment.** Separation by the existing 1 px `--border-hi`, z-order, and a darker surface only — no glow or blur, consistent with the chrome's no-decoration rule. A hard offset shadow may be evaluated during QA.
15. **Persistence.** `localStorage` key `vml:panel-layout-v1`, versioned and defensively parsed (§3.3). Storage failure is silent and non-fatal.

### 3.3 Architecture

**Mechanism: float in place, no portal, no remount.** The panel's existing wrapper element stays in the same React position inside `.sidecarStack`. Switching to float only changes that wrapper's CSS to `position: fixed` with `left/top/width` from the store. Because the element never moves in the tree:

- Modulation's `view` and `expanded` state, Sound's and VFX's local UI state, and VCapture's inputs survive detaching and docking.
- Keyboard focus stays on the Float/Dock button after activation.
- No `createPortal` event-bubbling or container-identity pitfalls.

*Fallback if the P0 spike disproves fixed-in-stack on any target browser:* portal into a fixed layer and lift the few ephemeral states (Modulation tab and expanded row) into the store. React remounts a portal's children when its container changes, so this is strictly the second choice.

**State model** (design sketch, not code):

```ts
type PanelId   = 'sound' | 'vfx' | 'capture' | 'mod';   // stack order
type PanelMode = 'stack' | 'float';
interface FloatGeometry { x: number; y: number; w: number }   // CSS px, viewport, top-left

// persisted — localStorage 'vml:panel-layout-v1'
interface PersistedPanelLayout {
  v: 1;
  modes: Record<PanelId, PanelMode>;
  geometry: Partial<Record<PanelId, FloatGeometry>>;
}

// session only
interface PanelSession {
  collapsed: Record<PanelId, boolean>;
  z: PanelId[];                     // back → front
}
```

Actions: `float`, `dock`, `dockAll`, `setGeometry`, `raise`, `toggleCollapsed(id, { additive })`, `noteOpened(id)`, `resetSession`, `clampAll(viewport)`.

**Files**

| File | New / Modified | Purpose |
|---|---|---|
| `lib/panels/layout.ts` | New | Pure logic: constants, `clampGeometry`, `snapGeometry`, `parsePersistedLayout`, accordion transitions. No React, no DOM — fully verifiable under `tsx`. |
| `lib/panels/config.ts` | New | `FLOATING_PANELS_ENABLED` kill switch (`NEXT_PUBLIC_FLOATING_PANELS !== 'off'`). |
| `stores/panelLayoutStore.ts` | New | Zustand store wrapping the pure logic; lazy `localStorage` hydrate, guarded writes. Exported from `stores/index.ts`. |
| `features/panels/FloatablePanel.tsx` | New | Slot wrapper: stack passthrough or fixed float; drag handle behavior, click suppression, raise-on-press. |
| `features/panels/PanelModeButton.tsx` | New | Float/Dock toggle plus Move (keyboard) button for panel headers. |
| `features/panels/useFloatCapable.ts` | New | `matchMedia` hook for the desktop gate. |
| `features/panels/viewport.ts` | New | `readViewport()` and a reactive `useViewport()` (window size minus the `--inspector-w` column). |
| `features/panels/usePanelCollapsed.ts` | New | Drop-in for each panel's local `collapsed` state, backed by the store. |
| `features/panels/panelSlot.module.css` | New | Slot and float styles (child-combinator selectors reach the existing `.modPanel` across CSS-module boundaries). |
| `components/ui/Icon.tsx` | Modified | `PanelFloatIcon`, `PanelDockIcon`, `MoveIcon`. |
| `features/board/FocusedAssetOverlay.tsx` | Modified | Route panel toggles through one `togglePanel`, wrap each panel in `FloatablePanel`, compute stacked-only `data-*` flags and spacer, add *Dock all panels* overflow item, reset session state on tile change. |
| `features/inspector/SoundPanel.tsx`, `VfxPanel.tsx`, `ModulationPanel.tsx`, `features/board/CapturePanel.tsx` | Modified | Replace local `collapsed` state with the store hook; add `data-panel-handle` to the header; add `PanelModeButton`. ~4 lines each. |
| `features/inspector/ModulationPanel.module.css` | Modified | Hide `.desktopBody` when collapsed (fixes the Modulation collapse gap). |
| `features/features.module.css` | Modified | `.sidecarStack[data-stacked='false']` collapses to zero width so an all-floating state leaves the tile centered. |
| `scripts/verify-panel-layout.ts`, `package.json` | New / Modified | `npm run verify:panel-layout`. |

**No changes** to the pool, renderers, sandbox, modulation bus, stores other than the new one, API routes, database, or security headers.

**Layout invariant.** The `data-mod / data-sound / data-vfx / data-capture` attributes and the spacer count **stacked** panels only. With every panel floating, the stack element still exists (so panels keep their React position) but is `width: 0` with no spacer, and the tile remains centered exactly as it does with nothing open.

### 3.4 Edge cases and gotchas

| Case | Handling |
|---|---|
| Drag released over the bare scrim closes the overlay | Pointer capture **only once the drag threshold is crossed** (capturing on press retargets a plain header click to the slot and closes the overlay — found and fixed in browser testing), window-level move/up tracking until then, **and** a one-shot capture-phase `click` suppressor after any drag past the threshold, removed on the next tick |
| Text selection while dragging | `preventDefault` on the initiating `pointerdown`; drag starts only from non-interactive header area |
| Per-move React re-renders of heavy panels | Drag writes CSS variables directly in `requestAnimationFrame`; the store is updated once, on release |
| Persisted geometry from a larger monitor | Clamped at hydrate and on every resize; *Dock all panels* is the escape hatch |
| Corrupt or hostile `localStorage` | `parsePersistedLayout` rejects unknown ids/modes, non-finite or out-of-range numbers, `__proto__`-style keys; any failure falls back to defaults, never throws |
| Nav drawer (z 50) opened over a left-snapped panel | Temporary occlusion; accepted, verified in QA |
| Window narrower than 821 px mid-session | The scrim is `display: none` there, so floating panels hide with it; they return when the window widens |
| Mobile sheet | Uses `embedded` bodies before the shell renders; the new store hook is called unconditionally (hook order preserved) but its state is unused there |
| Panel content taller than the space below | `max-height` from `--panel-y`; body scrolls inside the panel |
| Tooltips / selects inside floats | Rendered by the existing components at their own z-indices (`--z-tooltip: 70`); verified in QA |

### 3.5 Performance

No renderer, pool, or modulation-bus code runs differently. The drag path touches only the panel's own element. Acceptance is "no measurable change to the focused tile's frame rate while dragging" against the P0 baseline (`LiveIndicator` / `pool.fps`), tested on the heaviest shader in the library.

### 3.6 Accessibility

Float/Dock and Move controls are real buttons with labels and tooltips; arrow-key movement; visible focus; focus preserved across mode changes; reduced-motion respected (no animated transitions are introduced); ARIA labels on the panel `aside` elements are unchanged.

### 3.7 Rollout and rollback

- **Rollout:** ship behind nothing new — the stack path is behavior-identical when nothing is floated. The accordion applies immediately.
- **Rollback (fast):** set `NEXT_PUBLIC_FLOATING_PANELS=off` and redeploy; floating controls disappear and every panel renders in the stack. The accordion stays (it lives in the same store, independent of the switch).
- **Rollback (full):** revert the feature branch merge. No data migration, API, or schema is involved, so nothing needs undoing.

### 3.8 Exit criterion

With Sound, VFX, VCapture, and Modulation open, a person can drag any panel by its header out of the stack, place it anywhere in the app frame clear of the Inspector, move it with the keyboard, dock it back, and dock all; the focused tile never shifts; expanding a stacked panel collapses the others (including Modulation, on either tab); a reload restores positions; leaving or switching tiles closes every panel; mobile is unchanged; the tile's frame rate is unaffected by dragging; `typecheck`, `lint`, `verify:panel-layout`, and `build` pass.

---

### 3.9 Implementation notes (rev 15)

Built as designed, with three changes forced by testing and one convenience addition; full results in `SPRINT_FLOATING_PANELS.md` §11.

- Pointer capture moved from press to drag-start (a plain header click was closing the whole overlay).
- Detached panels are at least 320 px wide, and the minimum width is 240 (not 260).
- An inline *Dock all panels* header button was added because the overflow menu is not visible at desktop widths.
- Unverified: Safari, Firefox, and real-GPU frame rate.

**Post-review changes (owner local testing, 2026-09-21):**

- **Detach direction.** Float previously kept the left edge fixed, so widening to 320 px pushed the panel's right side over the tile. It now anchors by the right edge and grows leftward (`detachGeometry`), with a 32 px extra leftward shift on the button path (`FLOAT_BUTTON_OFFSET`). Verified at 2200 px wide: right edge exactly 32 px left of where it was, 48 px clear of the tile.
- **Drag cost.** Dragging rewrote `left`/`top` and a CSS variable feeding a `calc()` max-height every pointer move — one layout and one style recalculation per move. It now moves by `transform` (with `will-change: transform` only for the length of the drag), computes clamp/snap once per frame from the latest pointer sample, and writes `left`/`top` once on release. Measured on an identical 90-move scripted drag: layout passes 89 → 1, layout time 8.6 → 0.1 ms, style-recalc time 43 → 17.7 ms. The Inspector-width lookup behind `useViewport` is also cached (it called `getComputedStyle` on every snapshot read).
- **Limit of that work.** Panel movement is still driven by the main thread, so on a very heavy tile it can never be faster than the tile's own frame rate; the change removes the panel's share of the frame, not the tile's.

## 4. Slice 2 (deferred) — Phase 6.5A Stage page + pop-out window

**What:** one chrome-free page, `/stage/[itemId]` (server: `requireUser` + `getBoardItem`; client: a full-viewport black host that promotes the tile at full quality; F / double-click for fullscreen; idle cursor hide; black on error). A **Pop out** button beside Fullscreen opens it with `window.open` from the click (named window per tile, blocked-popup handling); the window can be dragged to another display and fullscreened there.

**Why a separate page instead of moving the tile into a popup:** the pool is one-host-per-tile and p5 sandboxes message the opener's `window` (§2.2), so moving the tile would break every p5 tile and couple two windows' animation loops. A separate page has its own pool and loop, needs no renderer changes, and is the same page the OBS link later reuses.

**Live sync:** a publisher subscribes to `inspectorStore` (params, mod, effects) and sends over `BroadcastChannel`, coalesced per frame; the Stage applies with the pool's existing setters (`setBaseParams`, `setModState`, `setEffects`). No server, no debounce.

**v1 limits:** LFO and MIDI-driven base values carry over; audio/mic-routed modulation and tile sound do not; the main window's tile keeps rendering (that tile costs GPU twice while the pop-out is open). **v1.1:** relay modulation *source* values (audio bands, mic, controller slots) at ~30 Hz over the same channel into the Stage's bus.

**Quality:** give the Stage page its own GL stage ceiling above 1280 (measure first).

**Re-entry trigger:** owners ask for a controls-free capture target beyond what fullscreen already gives, or want a second-display output.

## 5. Slice 3 (deferred) — Phase 6.5B OBS Browser Source link

Reuses the Stage page with token instead of cookie auth.

- **Data:** one table `output_links` (owner, board item, token hash, created, nullable expiry, revoked-at) via the existing `db:migrate` runner.
- **Routes:** `/api/output-links` (create / list / revoke; owner-checked), `/api/output/session` (bearer → allowlisted projection), public `/output/[shareId]` reading the token from the URL fragment.
- **Projection:** `getBoardItem`'s resolved result trimmed to type, source or URL, schema, params, mod, effects, and needed texture posters; sound off.
- **Following edits:** ETag polling (~2 s) — follows *committed* edits ~1–2.5 s after release (500 ms persist debounce plus poll). Not live-drag.
- **Hardening:** `/output/*` header rule (no-store, no-referrer, noindex) in `lib/security/headers.ts` with `verify:headers` extended; Upstash rate limits; hashed token at rest; generic not-found responses.
- **UI:** a *Live output* section in VCapture (create / copy / replace-revoke / last-seen). `CapturePanel` is currently gated to non-snapshot shaders, so Record and Live Output need separate gates.
- **Transparency:** image and SVG first (no GL alpha involved); shader alpha needs per-renderer QA.

**Re-entry trigger:** users need a stable Browser Source URL that survives without the app window (Window Capture no longer sufficient).

## 6. Parked backlog (from the rev 2 plan) and re-entry triggers

| Item | Why parked | Re-enter when |
|---|---|---|
| Live Session Bus (roles, leases, WebSockets / managed realtime) | Polling and `BroadcastChannel` cover the goals | Live-drag mirroring into OBS is demanded, or the mobile controller is approved |
| Mobile Companion Controller (QR pairing, controller grants) | Depends on the bus | After Playground, if live-performance demand is real |
| Window Management API display picker, Document Picture-in-Picture | Chromium-only enhancements to the pop-out | After 6.5A has real use |
| Spout2 / Syphon native bridge | OS-specific support burden | Browser Source proven insufficient by measurement |
| Docking library, tabs, layout presets | Not needed for four panels | Floating panels see heavy use and people ask for saved layouts |
| Shader/p5 alpha transparency | Needs per-renderer QA | After 6.5B |
| Audio-reactive relay over a network transport | Needs the bus | With the bus |

The original rev 2 document is retained unchanged in `docs/` (with a deferral banner) as the reference for the contracts, security requirements, and test matrix these items will need.

## 7. Using OBS today (no code)

- **Window / Display Capture** of the browser window works now.
- Pressing **F** on a focused tile enters fullscreen, which hides the sidecar panels and the header action buttons; the title bar with the fullscreen and close buttons remains, so crop it in OBS.
- **VCapture + Record** already exports MP4/WebM clips of shader tiles (video only, no audio).
- *Possible micro-win, not scheduled:* auto-hide the fullscreen title bar and cursor after a few idle seconds. Cheap, contained to `FocusedAssetOverlay`, and would make fullscreen Window Capture fully clean. Raise it if wanted; it is deliberately not part of Slice 1.

## 8. Decisions log

**Locked defaults for Slice 1** (change before task P2 starts if you disagree):

| # | Decision |
|---|---|
| D1 | Accordion is on by default; Shift-click on the chevron expands additively |
| D2 | Code panel stays docked in v1 |
| D3 | MIDI/Controllers stays inside Modulation and floats with it |
| D4 | Position and mode persist per device; open and collapsed state are session-only |
| D5 | No corner-resize in v1 (width persisted, fixed per panel) |
| D6 | Floating panels may overlap the tile |
| D7 | "Desktop" means ≥ 821 px wide and a fine primary pointer |
| D8 | `NEXT_PUBLIC_FLOATING_PANELS=off` is the kill switch |
| D9 | Float in place (no portal); portal is the documented fallback only |

**Open, low stakes:** whether MIDI should eventually be its own panel (a small split later, since `ControllerPanel` is already a separate component); whether to add a first-use hint beyond the tooltips.

## 9. Risks (Slice 1)

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Fixed-in-stack behaves differently on Safari/Firefox | Low | Medium | P0 spike on all three before any build; portal fallback documented |
| Drag-release closes the overlay | High if unhandled | High | Pointer capture plus capture-phase click suppression; explicit QA case |
| Accordion surprises people who want two panels open | Medium | Low | Float one, or Shift-click; tooltip mentions it |
| Panel lost off-screen after a monitor change | Medium | Medium | Clamp on hydrate and resize; *Dock all panels* |
| Scope creep into a full docking system | Medium | Medium | Non-goals above; docking library is parked with a trigger |
| Modulation collapse fix misses the Controllers tab | Medium | Medium | Explicit acceptance case in P3 on both tabs |
