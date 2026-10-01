# Phase C — trim-aware downloads

Baseline: main `7e2aed1` (Phase B installed).

## Cause and change

Phase B deliberately saved preview trim but both inspector Download handlers fetched `srcUrl` directly. They now share one trim-aware download hook. A shortened range is encoded into a derived file; full range or Reset downloads the original unchanged bytes. Screenshot and ordinary upload downloads keep their existing path.

A click snapshots the current preview range, including a selection whose autosave is still pending. Editing during export affects the next export. Closing the inspector or changing the selected tile aborts fetch/conversion and suppresses the late download. An export failure displays an error and does not silently substitute a full-length file.

Output stays in the saved source format: AVC MP4, or WebM with the existing VP9-first codec resolver. The actual source container is detected from file bytes. Resolution and source frame rate are preserved; the encode uses an explicit 8 Mbps bitrate, matching capture. Source timestamps are rebased for the selected interval, and final sample duration is bounded. Arbitrary hundredth-second ranges are frame-aligned in output and can differ from the displayed duration by up to one frame. One whole clip is exported, with no extra loop repetitions.

Export uses the already displayed saved clip. It does not reapply Smooth, consume the raw master, add fades/interpolation, or change the capture engine. This preserves the existing preview's image sequence as closely as encoding allows. Trimming can expose a different join; no phase-locked or seamless-loop guarantee is added.

Trim requires decoding and re-encoding. Codec, resolution, frame rate, and bitrate settings are retained; compressed image data is not lossless or byte-identical. The original and raw master are preserved. Export remains at original recorded speed; playback speed and later inspector VFX changes are not baked into this trim-only fix.

Supported scope: current video-only MP4/WebM captures, including legacy captures recognized by the existing capture tag. Missing decode/encode support, invalid bounds, unexpected audio, and files over 128 MiB produce a clear error. Original downloads remain available after Reset. No database migration, seed, server upload, or dependency change is required.

This closes trim-aware Download. Additional derived export controls, regenerated Smooth joins, speed/VFX rendering and intro/outro transitions remain separate later work.

## Verification

- TypeScript, optimized Next build, targeted lint (new files), and diff checks passed.
- Existing Phase A timing/provenance, Phase B scope/bounds, and 108 security guard checks passed.
- Real Chromium export/decode checks: MP4 + WebM, start-only/end-only/middle trims, non-frame-aligned ranges, minimum 0.1 s range, frame count, source boundary colors, unchanged source bytes, invalid bounds and pre/during-export cancellation.
- 0.8–2.4 s exported as 1.6 s in both formats; minimum 0.1 s exported as 0.1 s. Non-aligned 1.17–3.91 s produced 2.733 s (within one frame of 2.74 s).
- Uploaded Spatial HUD MP4: original 5 s, 752 × 604, 30 fps; trimmed export 1.6 s at the same resolution and frame rate, independently confirmed by ffprobe. SSIM against the corresponding original interval was 0.993535 on this capture; this is a single-fixture quality result, not a guarantee for every clip.
- Shared Download hook checked at 1440 and 390 px with actual downloaded files, original byte equality after Reset, local preview changes and close cancellation.
- Actual iPhone Safari/iMac Chrome production testing remains pending. Chromium tests do not establish Safari hardware performance.

```sh
npm run typecheck
node --import tsx scripts/verify-capture-phase-a.ts
node --import tsx scripts/verify-capture-phase-b.ts
node --import tsx scripts/verify-security-guards.ts
npm run build
```

Optional real browser verifier:

```sh
node --import tsx scripts/verify-capture-phase-c-browser.ts
```

Use `VML_CHROME_PATH` to point to an installed Chrome executable if Playwright Chromium is unavailable. `VML_USER_CLIP_PATH` optionally adds a local MP4 to the test; it is never uploaded. The verifier writes local results to `artifacts/capture-export-checks`.
