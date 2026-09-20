# Video Export Engine — Architecture & File Manifest

**Origin:** Built for Visual Mood Lab's "Video Export Foundation" sprint.
**Status:** Working in production. Documented here for reuse/porting into
other projects — this describes a self-contained subsystem, not something
tied to VML's specific asset model beyond the one integration point noted
in §6.

---

## 1. What this is, in one paragraph

A client-side pipeline that records a live `<canvas>` — anything already
rendering on screen — into a real, seekable MP4 or WebM file, entirely in
the browser, with no server-side transcode step. It uses the WebCodecs
API through **Mediabunny** (not `MediaRecorder`, not `ffmpeg.wasm`) to get
frame-level control, which is what makes the "seamless loop" feature
possible. The output is a standard video `Blob`, ready to upload anywhere.

---

## 2. Why this architecture, not the obvious alternatives

This is the part most worth preserving for a future build — the reasoning
cost more than the code did.

| Alternative considered | Why it lost |
|---|---|
| `MediaRecorder` + browser's native encoder | No frame-level control at all — you get whatever chunks the browser decides to hand you, on its own timing. That's fatal for a loop feature: you can't blend "the last N frames" toward "the first N frames" if you never get individual frames, only an opaque stream. |
| `MediaRecorder` (WebM) → `ffmpeg.wasm` transcode to MP4 | Works, but costs a ~25–30MB WASM payload and a slow software transcode pass after every recording, for a problem WebCodecs solves natively. |
| `mp4-muxer` + `webm-muxer` (raw WebCodecs, hand-rolled) | This is what the first working version actually used. Both packages were **formally deprecated by their own author the same week they were installed** — "superseded by Mediabunny... no longer maintained." Migrated immediately, before any real usage accrued on the deprecated path. |
| **Mediabunny (chosen)** | Actively maintained, same author as the two deprecated packages, unifies MP4 and WebM under one API instead of two separate libraries, and its `CanvasSource` abstraction eliminates almost all manual `VideoFrame`/`VideoEncoder` plumbing — you hand it a canvas, it handles sampling, encoding, and muxing internally. |

**Browser support floor:** Chrome 94+, Edge 94+, Firefox 130+, Safari
16.4+ for the video half of WebCodecs (`VideoEncoder`/`VideoFrame`).
Audio encoding (`AudioEncoder`) only shipped in Safari 26 — irrelevant
here since this pipeline is deliberately video-only (see §7).

---

## 3. The one hard architectural constraint

**This can only capture from a genuine, readable `<canvas>` element.**

That sounds obvious until you hit the actual wall: if the visual being
captured renders inside a **sandboxed, cross-origin iframe**
(`sandbox="allow-scripts"` without `allow-same-origin` — the standard,
correct way to isolate untrusted user code, e.g. a p5.js sketch runtime),
the browser will **not** let the host page read pixels out of that
canvas. Not a missing API, not a bug — a deliberate, unbypassable
cross-origin security boundary.

**What this means for reuse:** anything that renders directly onto a
canvas the host page owns (WebGL/Canvas2D shaders, `<video>`/`<img>`
elements, most creative-coding output that isn't sandboxed) — this
pipeline captures it with zero extra work. Anything rendering inside an
isolated iframe needs the iframe to actively **stream frames out** via
`postMessage` (e.g. `createImageBitmap(canvas)` on the sandbox's own side,
transferred to the host) before this pipeline can reach it at all. That
bridge is real, separate work — deliberately out of scope here, and
still un-built even in the origin project.

---

## 4. Data flow, end to end

```
User presses Record
        │
        ▼
getPool().get(itemId)?.getCanvas?.()   ← pulls the live HTMLCanvasElement
        │                                 from whatever renderer owns it
        ▼
startCapture(canvas, { format, durationSec }, onProgress)
        │
        ├─ resolveVideoCodec(format, w, h)      ← Mediabunny capability check
        │    canEncodeVideo() / getFirstEncodableVideoCodec()
        │
        ├─ new Output({ format, target: new BufferTarget() })
        ├─ new CanvasSource(dedicatedOutputCanvas, { codec, bitrate })
        ├─ output.addVideoTrack(videoSource, { frameRate })
        ├─ output.start()
        │
        ▼
RecordingHandle — own requestAnimationFrame loop, independent of
whatever render loop is driving the source canvas:
    each tick →
        1. draw source canvas onto dedicatedOutputCanvas (1:1, or a
           crossfade blend during the final N frames — see §5)
        2. await videoSource.add(timestamp, duration, { keyFrame })
           ← this await is real backpressure: next tick only fires
             once Mediabunny is actually ready for another frame
        3. repeat until duration reached (or manually stopped)
        │
        ▼
output.finalize() → target.buffer (ArrayBuffer) → new Blob(...)
        │
        ▼
uploadCapturedClip(blob, { sourceTitle, format })
        │
        ├─ POST /api/upload           → signs a direct-upload URL
        ├─ PUT <signed URL>           → bytes go straight to blob storage,
        │                                never through the app server
        └─ POST /api/assets           → registers the uploaded file as
                                          a real, browsable asset
        │
        ▼
Board/UI updates with the new asset
```

---

## 5. The seamless-loop technique (Tier 1)

Worth preserving on its own — this is a general technique, not
VML-specific.

**The problem:** most generative/live visual content is not periodic. fbm
noise, particle motion, anything with real-valued continuous state — there
is no frame N that exactly equals frame 0, so there's no true cut point
for a loop.

**The fix — crossfade-to-start, not a real phase-locked loop:**

1. During the **first** `overlapFrames` of the recording (a few hundred
   ms worth, computed from a configurable overlap duration × fps, capped
   at ~24 frames), stash a still `ImageBitmap` of each of those frames.
   This is the only extra memory this technique holds onto — a handful of
   small bitmaps, not the whole recording.
2. Record normally for the middle of the clip.
3. During the **final** `overlapFrames`, instead of encoding the raw
   source frame, draw a blend: the current frame first, then the
   correspondingly-indexed *head* frame on top at increasing opacity as
   the recording approaches its end. Encode that composite frame instead.
4. Result: the last frame of the recording is visually very close to the
   first frame, so looping the finished video reads as seamless — a real,
   working illusion, not a mathematical guarantee.

**Manual early-stop skips this entirely** — if the person stops the
recording before it reaches its natural duration, there's no "final N
frames" to blend, so the clip is delivered as-is, honestly labeled as a
non-looping clip rather than faking a blend against an arbitrary cut.

**A real phase-locked loop** (recording an exact integer multiple of a
known oscillator/LFO period, needing zero blending) is possible if the
source has a genuinely periodic driver — noted as a fast-follow, not
built here, since it only applies to a subset of possible content.

---

## 6. The one project-specific integration point

Everything above is portable as-is. The **only** place this touches
VML's own data model is the capture *source* lookup:

```ts
const renderer = getPool().get(asset.itemId);
const canvas = renderer?.getCanvas?.();
```

`getPool()` is VML's own renderer-registry/render-loop manager — in a
different project, this line becomes "however you get a reference to the
canvas you want to record." The renderer classes each expose a
`getCanvas(): HTMLCanvasElement | null` accessor; **that accessor is the
entire integration contract** the capture engine depends on. Anything
that can hand back a real canvas reference satisfies it.

Similarly, `uploadCapturedClip()`'s sign → PUT → register flow is generic
(three fetches, works against any signed-upload storage backend); the
specific endpoints (`/api/upload`, `/api/assets`) are VML's, swappable for
whatever an upload/asset-registration API looks like elsewhere.

---

## 7. Deliberate scope boundaries (still true today)

- **Video only, no audio track.** `AudioEncoder` only ships in Safari 26+;
  baking in a tile's live audio would drop support for every other
  browser. Left out entirely rather than shipped as a Safari-only feature.
- **No Worker / OffscreenCanvas.** The capture loop runs on the main
  thread. This was a deliberate call, not an oversight: the source canvas
  is typically already owned and drawn into every frame by an existing
  render loop on the main thread; moving capture into a Worker would
  require transferring that canvas to an `OffscreenCanvas`, which can only
  happen **once** and would break the existing renderer for everything
  else using it. `VideoEncoder`'s actual encode work already happens off
  the JS main thread via the browser's hardware encoder regardless of
  which thread calls it — the performance case for a Worker (true for
  `ffmpeg.wasm`'s software encoding) doesn't apply here.
- **MP4 output is deliberately H.264/AVC only**, never AV1/HEVC even when
  offered — AVC-only is specifically what makes MP4 the universal,
  mobile-safe export target in the first place.
- **Sandboxed/cross-origin canvas sources are out of reach**, per §3 — a
  real, named limitation, not a bug to chase.

---

## 8. Complete file manifest

Every file this subsystem touches, with its role. Files marked
**core, portable** carry no project-specific logic. Files marked
**integration glue** are the seams a different project would rewrite.

### Core engine — portable as-is

| File | Role |
|---|---|
| `lib/capture/types.ts` | Shared types: `CaptureFormat`, `CaptureOptions`, `CaptureProgress`, `CaptureResult`, duration/overlap constants |
| `lib/capture/support.ts` | Capability detection — `isCaptureSupported()` (sync, cheap) and `resolveVideoCodec()` (async, uses Mediabunny's `canEncodeVideo`/`getFirstEncodableVideoCodec`) |
| `lib/capture/engine.ts` | The engine itself — `startCapture()`, the internal `RecordingHandle` class (tick loop, crossfade blend, Mediabunny `Output`/`CanvasSource` wiring, finalize) |

### UI layer — portable with light adaptation (styling/component-library specific, logic is generic)

| File | Role |
|---|---|
| `features/board/RecordButton.tsx` | The only control that starts/stops a recording. Owns its own phase state machine (idle/recording/uploading/done/error), progress display, cleanup-on-unmount |
| `features/board/CapturePanel.tsx` | Format (MP4/WebM) and duration options — sets state `RecordButton` reads at record-start time, never itself triggers a recording |
| `components/ui/Icon.tsx` (additions) | `RecordIcon` (circle/square toggle by recording state), `VCaptureIcon`, `DownloadIcon` |

### Ingest/upload glue — integration-point specific, pattern is portable

| File | Role |
|---|---|
| `lib/persist/client.ts` (`uploadCapturedClip`) | Three-step upload: sign → PUT to storage → register as an asset. Mirrors the project's existing manual-upload flow so a captured clip behaves identically to any other upload once it lands |
| `app/api/assets/route.ts` | Asset-registration endpoint. Two things worth carrying forward regardless of project: (a) accept an optional `tags` array so captures can be distinguished from manual uploads, (b) the `isAllowedSrcUrl` ownership check — see §9, this one's a real, non-obvious bug worth not repeating |
| `lib/ingest/ingest.ts` | Where a registered video asset gets a poster/thumbnail. Note: at time of writing this project still lacks a real frame-grab poster for video (falls back to a generated placeholder) — a real implementation needs server-side `ffmpeg`, not part of this subsystem |

### Renderer contract — the capture *source* side

| File | Role |
|---|---|
| `renderers/shader.renderer.ts` (`getCanvas()`) | Returns the live WebGL/Canvas2D canvas directly — this renderer type was always capturable, no changes needed for capture to work |
| `renderers/media.renderer.ts` (`getCanvas()`) | Returns the mounted `<img>`/`<video>` element — also directly capturable |
| *(sandboxed sketch renderer — not capturable)* | Documented in §3 as the boundary this subsystem cannot cross without the sandbox streaming frames out itself |
| `lib/render/pool.ts` | The renderer registry `getPool()` is pulled from — project-specific, but the pattern ("a lookup that returns something exposing `getCanvas()`") is what any port needs to replicate |

### Host UI wiring — fully project-specific, shown for completeness

| File | Role |
|---|---|
| `features/board/FocusedAssetOverlay.tsx` | Desktop: header buttons (VCapture, Record), sidecar panel placement, capability gating (`canCapture` — currently `asset.type === 'shader'` only, per §3) |
| `features/board/MobileFocusedView.tsx` | Same, mobile layout — actions row placement, icon-only Record variant |
| `features/features.module.css` | Styling for the above — recording-state pulse animation, panel layout |

### Dependency

| Package | Version note |
|---|---|
| `mediabunny` | Replaces `mp4-muxer` + `webm-muxer` (both deprecated). Zero dependencies of its own, tree-shakable. Requires TypeScript 5.7+ for its type definitions |

---

## 9. Bugs found and fixed along the way — worth not repeating

**`isAllowedSrcUrl` host check was too narrow.** The original check
compared a registered asset's URL against the *bare* storage host
(`blob.vercel-storage.com`), but real storage responses return a
**store-specific subdomain** (e.g. `abc123.public.blob.vercel-storage.com`).
The bare-host check only ever matched a *fallback-constructed guess* URL,
never a real one — meaning every genuinely successful upload was silently
rejected by ownership validation, not just captured clips. Fix: match the
real subdomain pattern (`.endsWith('.public.blob.vercel-storage.com')`),
not just the exact bare host. Worth checking for the equivalent shape in
any storage backend before assuming a simple string-equality host check
is sufficient.

**GLSL reserved-word collisions bite hard, unrelated to this subsystem
directly but discovered via it.** Not part of the capture engine itself,
noted here only because it burned real time during this same work: `half`
is a reserved-for-future-use GLSL keyword. Using it as a local variable
name doesn't just fail quietly — it fails the **entire shader program's
compile**, taking down every code path in the file, not just the one
using the bad name.
