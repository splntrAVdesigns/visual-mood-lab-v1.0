# Phase B — capture trim

Baseline: production main `2ec46cb` (Phase A plus production migration hook).

## Included

- Video captures only: Playback → Speed → Trim → Loop, in desktop and mobile inspectors.
- Dark track, solid cyan selected range, slim cyan flag handles. No thumbnails or glow. Each handle has a 44 × 44 px hit area; only handle drags suppress touch scrolling.
- Start/end/total timestamps plus selected duration. Reset restores the entire clip.
- Arrow keys change a boundary by 0.01 seconds; Shift + arrows by 0.1 seconds; Home/End use the available boundary. Handles cannot cross; minimum interval is 0.1 seconds (or the whole clip for a shorter early-stop capture).
- Commit on release, keyboard edit, or inspector close. Per-source writes serialize; errors remain visible with Retry save. A trim applies to that captured source and its variations, just as source-level edits do; it is not a new snapshot-specific range.
- Separate nullable `assets.capture_trim` metadata. It preserves recording provenance, encoded clip, raw master, dimensions, codecs, bitrate, frame rate, and poster thumbnails. Older video captures identified by the existing `capture` tag are supported; missing duration is read using browser metadata.
- API checks ownership, video-capture scope, finite ordered bounds, minimum interval, and known source duration. No arbitrary recording metadata can be written through trim.
- Playback starts within the selected interval. Loop uses its selected boundaries; Loop off pauses on the final in-range frame. Explicit resume or enabling Loop restarts a finished range. Speed, effects, and unrelated changes do not restart finished one-shot playback. Reset returns to full-clip playback.

## Limits and next phase

This is non-destructive **preview trim**. The existing download returns the full original saved video. The inspector says so. Phase C must build a derived trimmed export with its own export settings and confirm preview/export agreement before calling this export trim.

Trimming a Smooth clip changes its join; the new join may show a cut. Smooth is a crossfade treatment of the original join, not a promise of complete asset motion cycles. Seeking at a trimmed boundary is browser playback and may have a brief seek delay; this change does not promise a gapless or phase-locked loop.

Trim times are seconds relative to the saved displayed clip (`srcUrl`), not the retained raw master. Phase C must explicitly map this timebase if it regenerates Smooth from the raw source; it must not blindly reuse an old overlap after trimming. No interpolation or extra fades are introduced here.

Optional five intro/outro presets remain later work, after looping/export upgrades and the broader phases 5 and 6: None by default, fade, spin/zoom, center zoom-in, and center zoom-out (final preset grouping to be settled later). They are separate from loop treatment; apply only to derived exports, preserve the source, and use mobile-friendly controls.

## Deployment

`0012_capture_trim.sql` adds one nullable JSONB column using `IF NOT EXISTS`. The existing production prebuild migration hook applies it before Vercel promotes this version. This changes no existing video files and requires no seed operation. Migration failure blocks the new build.

## Verification

- TypeScript and optimized Next build pass.
- Existing Phase A timing/provenance verifier and 108 security guards pass.
- Real Chromium MP4 and WebM capture regression checks pass for Off/Smooth, 150 frames at five seconds, cancellation, early stop, raw fallback and playback.
- Real MP4/WebM trim checks pass for range looping, one-shot hold, speed, global/per-tile pause, reset, unrelated edits, and unchanged source bytes.
- Component checks at 1440, 390 and 320 px pass for pointer drag, keyboard, 44 px targets, save/reset dispatch and no horizontal overflow.
- Authenticated local API and actual inspector checks cover new/legacy captures, ownership/scope/bounds rejection, saving, reload, reset, and placement. A Chromium mobile touch simulation verifies handle dragging.
- Actual iPhone Safari and iMac Chrome behavior still needs your approval. Automated mobile checks emulate Chromium, not Safari hardware.

Local checks:

```sh
npm run typecheck
node --import tsx scripts/verify-capture-phase-a.ts
node --import tsx scripts/verify-capture-phase-b.ts
node --import tsx scripts/verify-security-guards.ts
npm run build
```

Optional browser checks (with Playwright Chromium installed, or `VML_CHROME_PATH` pointing to Chrome):

```sh
node --import tsx scripts/verify-capture-browser.ts
node --import tsx scripts/verify-capture-trim-browser.ts
```
