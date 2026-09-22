# Sprint — Floating Sidecar Panels (Phase 4.98)

**Design source of truth:** `VISUAL_MOOD_LAB_FLOATING_PANELS_INTEGRATION_PLAN.md` §3  
**Blocks:** nothing (independent of Phase 5). Sequenced ahead of Phase 5 Playground.  
**Est:** 4–5 working days (revised up from the earlier 2–3-day core estimate once keyboard access, validated persistence, and the browser QA matrix are counted)  
**Status:** **Shipped (rev 17) — merged to `main` as `a3cfbe9` on 2026-09-21.** All of P0–P6 done; owner-verified on the Vercel preview in Safari and Firefox. Owner testing then surfaced a pre-existing backdrop-click bug (not caused by this sprint); fixed on `fix/scrim-click`, not yet merged — see §12.  
**Branch:** `feat/floating-panels` (from `main`)

---

## 1. Sprint goal

Let people on desktop pull the Sound, VFX, VCapture, and Modulation (with Controllers) panels out of the fixed left stack and place them anywhere in the app frame, and stop the stack from scrolling endlessly by making it an accordion — without moving the tile, touching any renderer, or changing mobile.

## 2. Scope

**In:** float/dock per panel · drag, snap, clamp, raise · keyboard move · accordion in stack mode · Modulation collapse fix · validated `localStorage` persistence · *Dock all panels* · desktop gate · kill switch · verification script · QA matrix · docs.

**Out:** Code panel floating · corner resize · tabs/splits/layout presets · mobile · pop-out window · OBS link · any pool/renderer/sandbox/API/DB change.

## 3. Decisions locked (from the integration plan §8)

D1 accordion on, Shift-click additive · D2 Code stays docked · D3 MIDI stays inside Modulation · D4 geometry/mode persist per device, open/collapsed are session-only · D5 no corner resize · D6 floats may overlap the tile · D7 desktop = ≥ 821 px and fine pointer · D8 kill switch `NEXT_PUBLIC_FLOATING_PANELS=off` · D9 float in place (no portal).

Raise any objection before **P2** starts; P0–P1 do not depend on them.

---

## 4. Tasks

Estimates are working days including local verification.

### P0 — Spike and baseline (0.5 d)

**Goal:** prove the mechanism and capture a performance baseline before building.

- On the feature branch, apply *throwaway* CSS (do not commit) making one panel wrapper `position: fixed` inside `.sidecarStack` while the overlay is open. Confirm in **Chrome, Safari, and Firefox** that it positions against the viewport, is not clipped by `.sidecarStack`'s `overflow-y: auto` or `.focusScrim`'s `overflow-x: auto`, and stays above `.focusPanel` and below the Inspector.
- Confirm no ancestor between the stack and the scrim has `transform`, `filter`, `contain`, or `will-change` (audit found none; the only `container-type` is on `.focusPanel`).
- Baseline: open the heaviest shader in the library at 1080p with all four panels open; record `LiveIndicator` fps at rest.
- Confirm `IconButton` passes the click event through (`e.shiftKey` for additive expand) — its props spread onto the button.

**Acceptance:** all three browsers behave identically; baseline recorded in the PR description. **If any browser fails, stop and switch to the portal fallback (integration plan §3.3) before P2.**

### P1 — Pure logic, store, and verifier (0.75 d)

**Files:** `lib/panels/layout.ts`, `lib/panels/config.ts`, `stores/panelLayoutStore.ts`, `stores/index.ts`, `scripts/verify-panel-layout.ts`, `package.json`.

- `layout.ts` (no React/DOM): constants (`MARGIN 8`, `SNAP 12`, `HANDLE_H 48`, `MIN_W 240`, `MAX_W 480`, `FLOAT_DEFAULT_WIDTH 320`, `DRAG_THRESHOLD 6`), `PANEL_ORDER`, `clampGeometry(geo, viewport, inspectorW)`, `snapGeometry(...)`, `parsePersistedLayout(raw)`, and accordion transitions (`onExpand`, `onOpen`, `onDock`, `onDockAll`).
- `panelLayoutStore.ts`: persisted slice (`modes`, `geometry`) and session slice (`collapsed`, `z`); lazy hydrate from `vml:panel-layout-v1` behind a `typeof window` guard; guarded writes only on float / dock / dock-all / geometry commit / clamp (never on raise or collapse).
- `config.ts`: `FLOATING_PANELS_ENABLED`.
- `verify-panel-layout.ts` + `"verify:panel-layout": "tsx scripts/verify-panel-layout.ts"`, following the `verify-tile-state.ts` pattern (legitimate data never rejected; hostile data refused):
  - clamp: fits, too wide, negative, beyond right/bottom, non-finite input, viewport smaller than the panel;
  - snap: within/outside threshold per edge, Inspector boundary;
  - accordion: expand exclusive vs additive; floats exempt both ways; open, dock, dock-all;
  - parse: valid round-trip; unknown ids/modes; strings, `NaN`, `Infinity`, huge numbers; arrays; `__proto__`/`constructor` keys; wrong version; non-object input.

**Acceptance:** `npm run verify:panel-layout` passes with zero failures; `npm run typecheck` clean.

### P2 — FloatablePanel, drag, keyboard, CSS (1.25 d)

**Files:** `features/panels/FloatablePanel.tsx`, `PanelModeButton.tsx`, `useFloatCapable.ts`, `panelSlot.module.css`, `components/ui/Icon.tsx`, `features/features.module.css`.

- `FloatablePanel({ id, children })`: renders a slot `<div data-panel-id data-mode>`; stack mode is a plain full-width block; float mode is `position: fixed` with `left / top / width` and `--panel-y` from the store, `max-height: calc(100dvh - var(--panel-y) - 8px)`, flex column so the panel body scrolls internally (child selector `> aside` with `flex: 0 1 auto; min-height: 0`). Raise on `pointerdown`.
- Drag: begins on `pointerdown` inside `[data-panel-handle]` when the target is not interactive (`button, a, input, select, textarea, [role='tab']`), primary button, fine pointer. `preventDefault` on that `pointerdown`. Move/up are tracked on `window` from the press (not on the slot); the pointer is captured **only once the 6 px threshold is crossed** (capturing on press retargets a plain header click to the slot and closes the overlay — found in browser testing, see §11). Past the threshold in stack mode, detach at the panel's current rect (no jump; at least 320 px wide), then continue. Moves write CSS variables in `requestAnimationFrame` (no React state per move); Alt disables snap. On release, commit geometry once; suppress the trailing click with a one-shot capture-phase listener removed next tick. `pointercancel` reverts.
- `PanelModeButton({ id })`: Float / Dock toggle (looks up its slot with `closest('[data-panel-id]')` for the rect), plus a Move button in float mode handling Arrow / Shift+Arrow (`stopPropagation`). Labels and `Tooltip`s: "Float panel — or drag the header", "Dock panel", "Move panel (arrow keys)".
- `useFloatCapable()`: `matchMedia('(min-width: 821px) and (pointer: fine)')` plus the kill switch, subscribed to change.
- CSS: `.sidecarStack[data-stacked='false'] { width: 0; }`; float slot styling using existing tokens only (`--border-hi`, `--bg-surface`); no glow/blur.
- Icons: `PanelFloatIcon`, `PanelDockIcon`, `MoveIcon` (16×16, 1.25 stroke per `Icon.tsx` conventions).

**Acceptance:** with the overlay wiring from P3 stubbed or complete, a panel can be dragged out, snapped, raised, moved by keyboard, and docked; releasing a drag over the scrim does **not** close the overlay; focus stays on the Float/Dock button after toggling; tile frame rate matches the P0 baseline during drag.

### P3 — Accordion, panel edits, overlay wiring (0.75 d)

**Files:** `features/board/FocusedAssetOverlay.tsx`, `features/inspector/SoundPanel.tsx`, `VfxPanel.tsx`, `ModulationPanel.tsx`, `ModulationPanel.module.css`, `features/board/CapturePanel.tsx`.

- Each of the four panels: replace `useState` collapsed with `usePanelCollapsed(id)` (returns `[collapsed, toggle(opts)]`, call unconditionally so hook order is stable before the `embedded` early return); add `data-panel-handle` to the `codeHeader`; chevron `onClick` passes `{ additive: e.shiftKey }`; add `<PanelModeButton id=… />` before the close button. Remove `useState` imports only where now unused.
- **Modulation collapse fix:** add `data-collapsed` to `ui.desktopBody` and hide it in `ModulationPanel.module.css` when collapsed, so both tabs collapse fully.
- Overlay: one `togglePanel(id)` used by both the header buttons and the overflow-menu items (replacing the duplicated `setShowX` chains while preserving today's rule that opening a panel closes Code and opening Code closes the four); call `noteOpened(id)` on open; compute `panelOpen` per id; render the stack container whenever any panel is open with `data-stacked`; wrap each panel in `FloatablePanel`; feed the four `data-*` attributes and the spacer from **stacked** panels only; add *Dock all panels* — an inline header button visible while a panel floats, plus the same item in the overflow menu for the narrow tier; `resetSession()` in the existing per-tile reset effect.

**Acceptance:** accordion behaves per spec on all four panels including Modulation on both tabs; Shift-click expands additively; floating panels are exempt; with every panel floating the tile is pixel-identical in position to the nothing-open state; leaving/switching tiles closes everything; mobile sheet unchanged.

### P4 — Persistence, resize, edge cases (0.5 d)

- Hydrate + clamp on load; window `resize` (rAF-throttled) calls `clampAll` and persists only if geometry changed.
- Confirm corrupt/hostile stored values fall back to defaults with no console errors.
- Verify kill switch: with `NEXT_PUBLIC_FLOATING_PANELS=off` no float UI renders and all panels stack.
- Verify narrow-window (<821 px) and coarse-pointer behavior.

**Acceptance:** reload restores mode and position; shrinking the window keeps every floating panel reachable; bad storage never breaks the overlay.

### P5 — QA matrix and fixes (0.75 d)

Run on a **Vercel preview deployment** (push the branch) for Safari/Firefox, plus local for Chrome. See §6.

### P6 — Docs and copy (0.25 d)

- Update `docs/IMPLEMENTATION_PLAN_SEPT20.md`: mark Phase 4.98 shipped, record what was verified, bump the revision line.
- Optional copy (owner's call): one desktop-only sentence in the onboarding toolbar step about dragging a panel header to float it (`features/onboarding/content.ts`), and a `floating-panels` row in the About roadmap.
- Note in the PR which follow-ons this unblocks (Blend sidecar as a fifth panel; XY pads).

---

## 5. Sequencing

| Order | Task | Depends on | Est. |
|---|---|---|---|
| 1 | P0 spike + baseline | — | 0.5 d |
| 2 | P1 logic, store, verifier | P0 pass | 0.75 d |
| 3 | P2 FloatablePanel, drag, keyboard, CSS | P1 | 1.25 d |
| 4 | P3 accordion, panel edits, overlay wiring | P1 (P2 for full behavior) | 0.75 d |
| 5 | P4 persistence, resize, edge cases | P2, P3 | 0.5 d |
| 6 | P5 QA matrix + fixes | P4 | 0.75 d |
| 7 | P6 docs and copy | P5 | 0.25 d |

P3's Modulation collapse fix and accordion have no dependency on P2 and can land first as a standalone commit (they already improve the stack before anything floats).

---

## 6. Verification gates

**Every task, before commit**

```bash
npm run typecheck
npm run lint
npm run verify:panel-layout        # once P1 exists
```

**Before pushing the branch**

```bash
npm run build
npm run verify:tile-state && npm run verify:render-pool && npm run verify:headers
```

(The last three are regression guards: this sprint touches none of what they cover, and they must stay green.)

### Manual QA matrix

| Area | Cases |
|---|---|
| Browsers | Chrome, Safari, Firefox (desktop) |
| Viewports | 1280×720, 1440×900, 1920×1080, 2560×1440; DPR 1 and 2 |
| Stack | open one/two/three/four panels; accordion expand/collapse; Shift-click additive; Modulation collapsed on Signals **and** Controllers tabs |
| Float | drag out; float button; drag back near stack then dock; dock all; raise order; snap to left edge / top / Inspector edge; Alt disables snap |
| Release-over-scrim | start drag on header, release over empty scrim and over the tile → overlay must stay open |
| Keyboard | Tab to Float/Dock and Move; arrows 16 px, Shift 64 px; focus retained after toggling |
| Layout invariant | tile does not shift when floating one, all, or docking; stack element collapses to zero width when all float |
| Lifecycle | close tile via X, Esc, scrim click; switch tile; fullscreen in/out with floats open; open Code with floats present |
| Persistence | reload restores mode and geometry; corrupt `vml:panel-layout-v1` in devtools → defaults, no errors |
| Resize | shrink window with floats near the right/bottom; move browser between monitors of different sizes |
| Interaction inside floats | Modulation select/slider, Sound track upload and mic toggle, VFX browse, VCapture format/duration, Record still works with VCapture floating |
| Layering | Inspector stays above floats; tooltips above floats; opening the Nav drawer over a left-snapped panel |
| Performance | drag a panel over the heaviest shader: `LiveIndicator` fps within noise of P0 baseline |
| Regression | mobile (<821 px) sheet unchanged; coarse-pointer tablet ≥ 821 px shows no float controls; kill switch off → all stack |

---

## 7. Git workflow

```bash
git checkout main && git pull
git checkout -b feat/floating-panels

# after each task (P0 spike code is not committed):
npm run typecheck && npm run lint && npm run verify:panel-layout
git add -A
git commit -m "feat(panels): <task summary>"

# suggested commit sequence
#   feat(panels): layout logic, store, and verifier
#   feat(panels): accordion + fix Modulation collapse
#   feat(panels): FloatablePanel drag, snap, keyboard
#   feat(panels): persistence, resize clamp, dock-all
#   docs: mark Phase 4.98 shipped

# before pushing
npm run build
git push -u origin feat/floating-panels      # Vercel preview deploy for Safari/Firefox QA

# after QA passes
git checkout main
git merge --no-ff feat/floating-panels
git push origin main
```

## 8. Rollback

- **Fast:** set `NEXT_PUBLIC_FLOATING_PANELS=off` in Vercel and redeploy — floating UI disappears, everything stacks, accordion remains.
- **Full:** `git revert -m 1 <merge-commit>` and push. No database, API, or schema changes exist to undo.

## 9. Definition of done

- [ ] All P0–P6 acceptance criteria met
- [ ] Strict TypeScript, no `any` in the diff
- [ ] `typecheck`, `lint`, `verify:panel-layout`, `verify:tile-state`, `verify:render-pool`, `verify:headers`, and `build` all pass
- [ ] Keyboard-navigable with visible focus; `prefers-reduced-motion` respected (no new animation)
- [ ] QA matrix passed on Chrome, Safari, and Firefox via the preview deployment
- [ ] Tile frame rate during drag within noise of the P0 baseline
- [ ] Mobile and kill-switch-off behavior verified unchanged
- [ ] `docs/IMPLEMENTATION_PLAN_SEPT20.md` updated (P6)
- [ ] Follow-ons noted: Blend sidecar as a fifth panel, XY pads, corner resize (v1.1), Code panel floating

## 10. Watch-outs during the sprint

- Do not add `transform`, `filter`, `contain`, or `will-change` to `.sidecarStack`, `.focusScrim`, or their ancestors — any of them would trap `position: fixed` and silently break floating. Leave a comment at the CSS where this matters.
- Keep the panel hook calls **above** each panel's `embedded` early return so hook order never changes between desktop and mobile paths.
- Do not add per-move store writes; heavy panels (Modulation with many rows) will stutter.
- If P0 disproves the in-place approach, stop and re-plan before writing P2 — the fallback changes the state-ownership design.

---

## 11. Results (rev 15, 2026-09-21)

Implemented on branch `feat/floating-panels`. P0–P4 are built and verified in **headless Chromium**; the Safari and Firefox rows of P5 and all of P6's optional copy remain.

### What was verified

| Check | Result |
|---|---|
| `npm run typecheck` | Clean |
| `npm run lint` | 0 errors, 53 warnings — identical to the pre-change baseline (no new warnings) |
| `npm run verify:panel-layout` | 82 passed (72 at first delivery; +10 for `detachGeometry` after owner review). Mutation-tested: three deliberately injected bugs (clamp ignoring the Inspector, accordion collapsing floating panels, parser copying raw keys) were each caught |
| Existing verifiers | `tile-state` 85 · `render-pool` 10 · `headers` 76 · `roll` 33 · `roll-store` 84 · `persist` 44 · `sandbox` 76 · `security` 108 · `schema-fuzz` 150 · `site-url` 38 · `control-surface`, `midi-runtime` PASS |
| `npm run build` | Passes |
| Browser suite (Playwright, Chromium, real app + seeded local DB) | 72 checks, 0 failing — accordion incl. Modulation on both tabs; float/dock by button, drag, and keyboard; state survival across detach/dock; no tile shift with 0/1/all panels floating; bounds and snap; z-order; dock-all; persistence across reload and across leaving the tile; resize re-clamp; corrupt and hostile storage |
| Mobile (390×844) | Embedded sheets open, no float controls, no page errors |
| Touch tablet (1024×768, coarse pointer) | No float controls, stack + accordion apply |
| Kill switch (`NEXT_PUBLIC_FLOATING_PANELS=off` build) | No float UI, a saved floating layout is ignored **and left intact**, accordion still applies |

### Defects found by browser testing (fixed)

1. **A plain click on any panel header closed the whole focused view.** Capturing the pointer on press made the browser retarget the resulting `click` to the slot element, which sits outside the panel's `stopPropagation` and bubbled to the scrim's `closeOverlay`. Fix: capture only after the drag threshold is crossed; until then move/up are tracked on `window`, so a fast flick cannot lose the gesture. Static checks could not have caught this.
2. **A floated Modulation title truncated to "Modulat…"** (two extra header buttons in 280 px). Fix: panels detach at least `FLOAT_DEFAULT_WIDTH = 320` wide.

### Deviations from this plan as written

- `MIN_PANEL_WIDTH` is **240**, not 260: a stacked panel can be as narrow as 164 px on a small window, so a 260 minimum would jump on detach.
- New `FLOAT_DEFAULT_WIDTH = 320` (above).
- An always-visible **Dock all panels** header button (shown only while a panel is floating) was added: the overflow menu only exists below 680 px of panel width, so it cannot be the only route. The overflow item remains for the narrow tier.
- Float/Dock/Move labels come from `IconButton`'s title/aria-label, matching the neighbouring header buttons, rather than the separate `Tooltip` component.
- Two helper files not listed in §4: `features/panels/viewport.ts` and `features/panels/usePanelCollapsed.ts`.

### Not verified (open)

- **Safari and Firefox** (not installable in the build sandbox). P5's cross-browser rows must be run on the Vercel preview. The P0 spike question — does `position: fixed` inside the stack behave identically? — is answered for Chromium only.
- **Frame rate on a real GPU.** The sandbox renders WebGL in software at roughly 2–8 fps, so absolute numbers are meaningless. The controlled comparison (identical mouse traffic with vs. without a panel drag) measured 0.92×–0.99× — within noise — but the "within noise of baseline" gate needs a real-GPU check on the preview.
- Visual focus-ring styling on the new buttons (they reuse the existing `IconButton` styles; not inspected separately).

### Observations for the owner's decision (not changed)

- ~~Floating a panel with the button leaves it exactly where it was~~ — **resolved after owner review:** panels now detach anchored by their right edge, widen leftward away from the tile, and the button adds a 32 px leftward shift (see "Post-review changes" below). One remaining trade-off: the rest of the stack still reflows up into the floated panel's old row, so a floated top panel can partly cover the next one until it is dragged away.
- ~~Pre-existing, unrelated to floating: a mouse press that starts inside any sidecar panel and is released over the bare scrim closes the overlay~~ — **fixed, see §12.** (The original note here additionally claimed this affected slider drags ending outside their panel; that was incorrect — `Slider` captures the pointer, so its drags were never affected. Only presses on plain content, such as panel text or the tile, were.)

### Post-review changes (owner local testing, 2026-09-21)

Owner testing on a heavy p5 tile confirmed floating and the accordion work as intended, and asked for two things before merge.

1. **Detach direction.** The widened panel grew rightward over the tile. Now: right edge anchored, grows leftward, +32 px leftward shift on the button path, pinned to the 8 px margin when there is no room. Checked at 1440 px (panel spans 8–328 px, clear of the tile at 342 px) and 2200 px (exactly 32 px left, 48 px clear).
2. **Drag speed.** Baseline on an identical 90-move scripted drag: 89 layout passes, 94 style recalcs (43 ms), 8.6 ms layout. Now: **1** layout pass, 94 recalcs (**17.7 ms**), **0.1 ms** layout. Mechanism: transform-only movement, one clamp/snap per frame from the latest sample, `left`/`top` written once on release, cached Inspector-width lookup. The remaining per-frame cost is one cheap inline-style update. On a very heavy tile the drag is still bounded by that tile's frame rate, since both share the main thread.

Regression status after both changes: typecheck clean; lint 0 errors / 53 warnings (baseline; none in new files); `verify:panel-layout` 82; all other verifiers unchanged; browser suite 72/72; mobile and touch-tablet runs 9/9. Still unverified: Safari, Firefox, real-GPU frame rate.

## 12. Scrim-click fix (rev 17, 2026-09-21)

**Owner report (verbatim intent):** clicking a panel isn't limited to floating panels — pressing anywhere inside the focused view's content and releasing over the bare background closed the entire view.

**Root cause.** Every dismissible backdrop in the app (`FocusedAssetOverlay`'s scrim, `CommandPalette`'s scrim, the shared `Dialog`) closed on `onClick` when `e.target === e.currentTarget` — the standard "did the click land on the backdrop" check. But the backdrop is an ANCESTOR of its panel, and when a mouse press begins on content and the release lands on the bare backdrop, the browser fires the resulting `click` event on the nearest common ancestor of the two targets — the backdrop itself. The check passed even though neither the press nor the release actually happened on empty backdrop.

**Correction to the note added in rev 16.** That note said this "also affects a slider drag that ends outside the panel." Verified false: `Slider` calls `setPointerCapture` on `pointerdown`, so every subsequent `pointermove`/`pointerup` for that gesture is delivered to the slider regardless of where the pointer physically is, and the panel's own `onClick={(e) => e.stopPropagation()}` then absorbs the resulting click. A slider drag never triggered this bug. What did: a press on plain panel content (body text, the "Kept for this session" notice, etc.) or on the tile itself, released over the bare scrim.

**Fix.**

- **`lib/ui/backdrop-dismiss.ts`** (new): pure decision logic — dismiss only if the pointer sequence's press AND release both landed on the backdrop, tracked from `pointerdown`/`pointerup` and consulted on `click`. A click with no observed pointer sequence (keyboard activation, assistive technology, or a press that began inside a cross-origin iframe such as the p5 sandbox, which never reports to this document) falls back to the click-target check — the pre-existing behavior, unchanged for those paths.
- **`components/ui/useBackdropDismiss.ts`** (new): a small hook wrapping that logic — `onPointerDownCapture`/`onPointerUpCapture`/`onPointerCancelCapture`/`onClick`, spread onto a backdrop element. Capture-phase, so it sees every press and release beneath it even when a descendant panel calls `stopPropagation`.
- **Adopted by all three backdrops:** `FocusedAssetOverlay` (with an `isBackdrop` override so the sidecar stack's gaps and the counterweight spacer still count as backdrop — clicking between two stacked panels still closes the view, unchanged), `CommandPalette`, and `Dialog` (disabled in `Dialog`'s modeless sidecar mode, which has no scrim interception to begin with).
- **`scripts/verify-backdrop-dismiss.ts`** (new) + `verify:backdrop-dismiss` npm script: 21 checks — every press/release/click combination exhaustively enumerated (exactly 1 of 8 dismisses), the no-pointer-sequence fallback, an unobserved release, and that no gesture's state leaks into the next click.

**Verification.**

- Reproduced first: a Playwright suite against unfixed `main` failed 6 of 25 checks — press on panel text, press on the tile, press on the backdrop released on the tile, the command palette, and the Upload dialog. (The slider check was in that batch too; it passed even on the unfixed build, confirming sliders were never affected.)
- After the fix: all 25 browser checks pass, including everything that must still close the view (a plain backdrop click, a click in the gap between two stacked panels, Escape, the X button, a touch tap on a coarse-pointer tablet) and everything that must not (any of the four backdrops, in both press/release orders, plus a slider drag as a sanity check that dragging itself is unaffected).
- `verify:backdrop-dismiss`: 21/21. Mutation-tested with four injected bugs — including reintroducing the exact original bug (click-target-only) — each caught.
- No regressions: the Phase 4.98 browser suite (72/72), the mobile/tablet run (9/9), typecheck, lint (0 errors, the same 53 warnings, none in the new files), and every other verifier including `verify:soak` (68) all still pass.
- **Not tested:** Safari and Firefox (Chromium only in the build sandbox). The onboarding guide's scrim shares the same code pattern but is a sibling of its panel rather than an ancestor, and the bug did not reproduce there in testing — left unchanged.

**Status:** built on branch `fix/scrim-click` (based on the merged `main`, `a3cfbe9`); **not yet merged.**
