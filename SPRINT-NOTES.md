# Visual Mood Lab v2.4 — hardening pass

```
npm install
npm run build
```

No manifest change — **no reseed needed**. Existing data carries forward.

---

## 1. Texture-picker, built for real

Disabled stub since Phase 0. Now a working picker: pick any board asset
with a captured poster, and sampler-driven shaders (ASCII Mosaic, Chromatic
Glitch) actually sample it.

Two deliberate constraints, both for the same underlying reason:

- **It samples the poster, not live output.** Sampling a live asset would
  need a second render pass per frame plus dependency ordering between
  renderers — what happens when two shaders sample each other? That's a
  real architecture change, not a control. A poster is a genuine captured
  frame, which is enough to make source-driven shaders do the thing they
  were written to do.
- **Self-reference is filtered out.** A shader sampling its own poster while
  generating that poster has no defined answer. Feedback Trails already
  covers "sample my own previous frame" correctly, through the backbuffer.

Image decoding is cached, because the uniform-binding path runs every frame
and would otherwise fire a request 60 times a second.

**This unblocks SVG Particle**, the last held port.

## 2. Performance budget — re-measured for the first time since Phase 0

§13 requires this every phase. It hadn't been done since the near-empty
Phase 0 shell, so I genuinely didn't know whether we were still inside
budget. Now measured:

- **215.9KB gzipped total** — about **12KB above the Phase 0 baseline**.
  That 12KB covers snapshots, the modulation bus, command palette, upload
  flow, hero canvas, texture picker, and 18 more assets. Comfortably inside
  the ≤60KB app-code allowance.
- **Posters: largest 12.3KB against a 40KB budget**, median 6.0KB, zero over.

§9 in the plan now carries measured values beside the targets, not just
targets. Two rows are marked honestly as not measurable without a browser
(60fps scroll, time-to-first-paint) rather than guessed at.

## 3. Reduced-motion unified

The hero canvas read `matchMedia` once at mount and never again; the render
pool listened for live changes. Toggling the OS setting mid-session left the
hero animating while everything else correctly stopped. One store value, one
listener, no way to disagree.

## 4. Focus-visible audit — my initial read was wrong

Worth saying plainly: I flagged this as a likely widespread gap based on
counting per-component CSS rules. That was wrong — there's a global
`:focus-visible` rule in `globals.css` already covering every focusable
element, which I'd missed.

The audit did find **one** real defect: `.input:focus` set `outline: none`
at higher specificity (0,2,0 vs the global rule's 0,1,0), silently
suppressing the focus ring on text inputs for keyboard users. The border
tint still changed, so it wasn't invisible — just much weaker than every
other control, and inconsistent. Fixed.

## 5. Renderer budget is now device-aware

§12's risk register claimed "quality tiers; posters-only mode below a
device-capability threshold" as the mobile-GPU mitigation. Only the quality
tiers were ever built — the budget was a flat 3 regardless of hardware. A
phone holding three concurrent WebGL/p5 contexts is a materially different
proposition from a desktop doing the same, for both frame rate and battery.

Now 1–3, chosen from `pointer: coarse` and `hardwareConcurrency`.
Deliberately capability signals rather than user-agent sniffing: those are
honest about what a device can do; a UA string is a guess about what it is.
This also de-risks the mobile layout phase before it starts.

## Verified this session

Typecheck and build clean · seed 48/48, **0 warnings** · board loads ·
bundle and poster sizes measured, not assumed · `verify-seed` still clean
after every change.

## Next

**Mobile layout phase**, now on a foundation that's been measured rather
than assumed. Two assets still outstanding to reach 50: SVG Particle (now
unblocked) plus one more to choose.
