# Visual Mood Lab v2.6 — mobile layout

```
npm install
npm run build
```

No manifest change — **no reseed needed**.

---

## A separate composition, not a squeezed one

The desktop focused view is a centred 1:1 graphic with the inspector in a
fixed drawer pinned to the right edge — two independently positioned
overlays that happen to sit side by side. Below about 820px that model has
nowhere to go: the drawer covers the exact thing being adjusted.

So the mobile view is a different component, not a media query on the old
one:

- **One full-height column.** Header, canvas, actions, tabs, scroll region.
- **The canvas is pinned and never scrolls away.** Watching what a control
  does while you drag it is the entire point of the app — a sheet that
  covers the graphic defeats it. Capped at 44% of viewport height so the
  controls always have room, including on a short landscape phone.
- **Everything below is one scroll region** with the full parameter list,
  grouped exactly as on desktop.
- **Modulation sits behind a tab**, not stacked underneath. A shader with
  twenty parameters plus routing for each would be an endless scroll;
  switching is cheaper than hunting. `ModulationPanel` gained an `embedded`
  mode so it renders inline rather than as a fixed sidecar with its own
  width, border and close button — duplicated furniture inside a container
  that already has all three.

Detection is **capability-based, not user-agent**: viewport width plus
pointer type, same reasoning as the renderer budget. A narrow desktop
window gets the mobile layout, which is correct — it responds to available
space and input method, not to a guess about hardware.

## Real fixes found while building it

**Pinch-zoom was blocked outright.** `maximumScale: 1` was set on the
reasoning that the board is a fixed app surface rather than a document.
That fails WCAG 1.4.4 and locks out anyone who needs to magnify to read a
control label. Largely theoretical while this was desktop-only; an actual
barrier the moment there's a mobile layout. Removed — and verified gone
from the rendered HTML, not just from the source.

**`100dvh`, not `100vh`.** Mobile browsers show and hide the URL bar; `vh`
doesn't account for it, so the bottom of the sheet would sit permanently
under browser chrome.

**`overscroll-behavior: contain`** on the sheet — rubber-banding past the
end of the control list would otherwise scroll the board underneath, which
is especially disorienting when the thing behind is a grid.

**Grid columns retuned.** The desktop `minmax(220px, 1fr)` yields a *single*
column on a ~360px phone, making 50 assets a very long scroll. 148px gives
two columns on the narrowest common phone, three on a large one.

**Snapshot delete made permanently visible** below the breakpoint — it's
hover-revealed on desktop, and there is no hover on touch.

**Fullscreen deliberately not exposed on mobile.** iOS Safari doesn't
support the Fullscreen API for arbitrary elements, only `<video>`. A button
that silently does nothing is worse than its absence.

## Verified this session

Typecheck and build clean · 50/50 seeded, 0 warnings · all mobile CSS
confirmed present in the compiled bundle (`mobileFocus`, `mobileStage`,
`mobileSheet`, `100dvh`, `overscroll-behavior`) · `maximum-scale` confirmed
absent from served HTML.

**Not verified by me:** actual touch interaction on a real device. Drag,
tab switching, and scroll behaviour are reasoned from the code and the
platform constraints, not observed. That's the first thing worth trying.

## Next

Phase 5 (Playground) — CodeMirror, hot-reload, live uniform parsing,
save-sketch-to-library, fork-an-asset. The last unbuilt phase in the
original plan.
