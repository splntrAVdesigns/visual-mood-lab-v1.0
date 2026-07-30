# Visual Mood Lab

A mood board for shaders, sketches, and motion. Every asset exposes parameters you can tune.

**Status: Phase 0 complete.** See `IMPLEMENTATION_PLAN.md` for the full roadmap.

---

## Running it

```bash
npm install
npm run dev          # http://localhost:3000
```

Other scripts:

```bash
npm run typecheck    # tsc --noEmit, strict
npm run verify:seed  # validates every seed asset parses into a valid schema
npm run build
```

---

## What exists after Phase 0

| Area | State |
|---|---|
| App shell | Header, left nav drawer, board region, right inspector drawer |
| Design tokens | Complete — `styles/tokens.css` is the single source of truth |
| UI primitives | Button, IconButton, Slider, Toggle, Select, TextInput, Drawer, Dialog, Tooltip, Field, Badge |
| State | Three Zustand slices: board, inspector, playback |
| Control schema | Complete and tested — `renderers/control-schema.ts` |
| GLSL uniform parser | Complete and tested — `lib/gl/parse-uniforms.ts` |
| Sketch params parser | Complete — `lib/sketch/params-to-schema.ts` |
| Seed assets | 2 of 20 (the reference implementations) |
| Board cards | Placeholder stages, real chrome |
| Renderers | **Not started** — Phase 2 |
| Persistence | **Not started** — Phase 3 |

The inspector is live: open any card and every control renders from a schema, validates on change, and shows a reset affordance when modified. Nothing is bound to a renderer or persisted yet — that is Phase 2 and Phase 3 respectively.

---

## Structure

```
app/            routes and layouts only — no domain logic
components/ui/  dumb primitives, zero domain knowledge
features/       everything that knows what a shader is
renderers/      the AssetRenderer contract and ControlSchema
lib/            gl helpers, sketch helpers, fixtures
stores/         Zustand slices
seed/           the starter library, loaded through the normal ingest path
scripts/        verification and seeding
```

**The rule:** if two features need it and it has no domain knowledge, it goes in `components/ui/`. The moment a shared component knows what a shader is, it belongs to a feature.

---

## The two authoring conventions

Both produce the same `ControlSchema`, which is why the inspector needs no per-type code.

**Shaders** — annotate uniforms in a trailing or preceding comment:

```glsl
uniform float u_density;  // @label(Grid density) @range(1, 64) @default(12) @log
uniform int   u_mode;     // @select(Grid=0 | Halftone=1 | Dither=2) @group(Effect)
uniform vec3  u_tint;     // @color @default(0.0, 0.83, 1.0)
```

Host-driven uniforms (`u_time`, `u_resolution`, `iChannel0`, …) are in `DEFAULT_RESERVED` and never become controls.

**Sketches** — export a plain `params` object:

```js
export const params = {
  count: { kind: 'slider', label: 'Particles', min: 50, max: 4000, step: 1, default: 1200 },
  tint:  { kind: 'color',  label: 'Tint', default: { r: 0, g: 0.83, b: 1, a: 1 } },
};

export default function sketch(p, get) {
  p.draw = () => { const n = get('count'); /* … */ };
}
```

Always read values through `get(id)` rather than closing over a variable, so inspector edits and modulation land on the next frame.

Run `npm run verify:seed` after adding either kind. It fails the build on a malformed annotation or an invalid control descriptor, which beats discovering it as a silently empty inspector panel.

---

## Keyboard

| Key | Action |
|---|---|
| `Space` | Pause / play all |
| `[` | Toggle the nav drawer |
| `Esc` | Close the focused drawer or dialog |
| `Tab` | Cycles within an open modal drawer |
| `← → ↑ ↓` | Adjust a focused slider (`Shift` for coarse) |
| `Home` / `End` | Slider min / max |

---

## Phase 2 — renderers

### One WebGL context, not forty

Browsers cap you at roughly 8–16 live WebGL contexts and silently kill the oldest, so a board of forty shader cards cannot each own one. `lib/gl/context-pool.ts` keeps **a single offscreen WebGL2 canvas**: each live shader renders into it in turn, and each card's cheap 2D canvas blits the result with `drawImage`. That blit is GPU-side and costs far less than a context switch — and context loss stops being a per-card lottery.

GL renders y-up while a canvas image is y-down, so the blit flips on the way out. Shaders behave the way their authors expect.

### One frame loop, not forty

`lib/render/pool.ts` drives **every** live renderer from a single `requestAnimationFrame`. Two invariants:

- at most `MAX_LIVE_RENDERERS` (6) mounted at once
- promoting past the ceiling evicts the least-recently-promoted **preview**; a focused card is never evicted, because you are looking at it

Cards move `poster → preview → focused` via `IntersectionObserver` with a 120px root margin. The poster stays mounted underneath the whole time, so demotion is instant and there is never a blank frame mid-scroll.

### Sketches run in a sandbox

`public/sandbox/index.html` runs in an iframe with `sandbox="allow-scripts"` and **no** `allow-same-origin` — null origin, no access to this document, its storage, or its cookies. User code never touches the main thread.

The watchdog is the point: the frame heartbeats every 500ms, and after 2s of silence the host tears it down. Without it, one `while(true)` in a sketch takes the whole tab down along with everything unsaved in it.

p5 is vendored to `public/vendor/p5.min.js` rather than pulled from a CDN, so the sandbox has no third-party runtime dependency.

### Shadertoy compatibility

`patchSource` normalises pastes: missing `#version`, `mainImage(...)` instead of `main()`, `gl_FragColor` instead of a declared `out`. Reserved uniforms bind under both conventions (`u_time`/`iTime`, `u_resolution`/`iResolution`, `u_mouse`/`iMouse`), so most Shadertoy shaders drop straight in.

A shader that fails to compile renders **hazard stripes**, not black, with the formatted error and offending source line shown on the card.

### Poster backfill

```bash
npm i -D playwright && npx playwright install chromium
npm run dev                 # in another terminal
npm run backfill:posters
```

Overwrites the Phase 1 placeholder posters with real renders. Playwright stays optional — the script exits with instructions rather than being a hard dependency.
