# VCapture sprint — Phase A: capture and looping

Phase A production testing release. The user authorized publishing Phase A to main after local account verification blocked testing. Phases B and C remain deferred.
Baseline: acc8d280f008801bbda794181d7e4266cd68efec.

## What changed

VCapture now exposes Off / Smooth and a 0.1–0.8 second transition control using the existing panel shell, buttons and sliders. Off is the default for conservative local review. Settings lock until recording, processing and saving finish. Desktop uses the existing sidecar; mobile uses its existing embedded panel. Loop buttons have 44 pixel minimum height.

Off encodes the live canvas once, without a loop edit. Smooth records the requested duration plus an extra overlap, preserves that raw master, and derives a clip of the requested duration. Its ending blends moving footage into the recorded opening segment; playback then continues into the next recorded frame rather than fading to a frozen first frame. Blending follows a smooth interpolation curve; this is not optical flow or synthesized intermediate motion.

The format codecs, 8 Mbps encoder setting, 30 fps default and existing even dimension handling are retained. Fixed timestamps follow elapsed time; brief missed slots repeat the last sampled frame and are reported. Longer rendering stalls or background interruption stop with untreated footage. Stopping early skips Smooth. During processing, Keep untreated saves the source instead. Closing the tile cancels capture. A save failure offers Download untreated source while the focused view stays open.

Capture provenance is stored in a new optional `assets.capture` JSONB column, separate from renderer parameters. Existing assets need no conversion. Smooth stores its untreated master as an additional file linked to the captured tile, without creating a duplicate board tile. Ownership is checked when registering both files; deleting the tile attempts cleanup of both. Capture size is limited to 128 MB for processing.

Saved video playback also respects global pause and play-once: unrelated Inspector edits no longer restart a video that has ended. Explicit per-tile resume or enabling Loop can restart it. The video speed slider now matches the renderer's positive minimum (0.0625).

## What is verified and what needs approval

Passed: desktop (1440 pixels) and phone-width (390 pixels) panel interaction with no horizontal overflow; production build; TypeScript; capture frame size checks including odd mobile dimensions; overlap/timing/provenance checks; existing 108 security guard checks. Targeted lint has zero errors and five existing warnings in the focused views and media renderer.

Real Chromium encoding/decoding checks passed for five-second MP4 and WebM captures in both modes. All produced 150 frames and five-second output. Off reused the identical raw Blob. The synthetic moving fixture had a smaller first/last frame discontinuity with Smooth. Early stop, cancellation, processing fallback, one-shot playback, loop restart and global pause/resume were exercised.

The local saved-file flow also passed for a synthetic Smooth WebM: processed and raw uploads, provenance reload and deletion of both files. A complex Nodal Matter shader in this software-rendered test browser triggered the stall guard and saved a warned untreated partial clip; full-duration performance on actual iMac/mobile hardware remains unverified.

These checks establish the mechanism, not visual perfection on arbitrary content. Smooth uses a second lossy encode: preserving codec, dimensions and bitrate does not guarantee identical visual quality. It can show ghosting on fast movement, cuts or very different endpoints. The untouched source remains available for later editing. Smooth records slightly longer, processes after recording and stores two files. Untreated fallbacks can include that extra overlap duration. Capture can report repeated frames under load; sustained gaps over two seconds stop the recording rather than hiding a long freeze. The retained raw master is not yet exposed as a normal Inspector download action; that belongs with Phase C export controls. Failed registration can leave uploaded files without a board record, as in the existing upload pipeline; the recovery action preserves local source bytes.

Actual iMac/Chrome content quality, mobile hardware performance and long captures still require the user's local approval. No claim of universally seamless looping or lossless Smooth output is made.

## macOS local test

Save the ZIP in Downloads. In Terminal, change into your existing Visual Mood Lab Git checkout first. Follow the commands in the delivery message or the ZIP's README. APPLY_PHASE_A.sh verifies baseline file hashes before writing and creates/reuses `sprint/vcapture-loop-trim`; it never pushes or merges.

Run `npm ci`, typecheck, the capture checks and build. Then:

```bash
bash scripts/vcapture-local.sh setup
bash scripts/vcapture-local.sh dev
```

The launcher blanks remote database and blob credentials, uses `.pglite-vcapture-test`, and writes uploads locally. It does not migrate your production database or overwrite `.env.local`. Stop other dev servers first; use http://localhost:3000. This isolated database has its own accounts: create a local test account and open the verification URL printed in the development terminal. Existing production credentials do not automatically create a local account.

Optional repeatable real-browser fixture (requires a compatible browser):

```bash
npx playwright install chromium
node --import tsx scripts/verify-capture-browser.ts
```

Or use installed macOS Chrome:

```bash
VML_CHROME_PATH='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' node --import tsx scripts/verify-capture-browser.ts
```

Approve locally with these checks:

1. Open a GLSL tile, open VCapture and record Off in both formats at 5 and 30 seconds. Confirm timing, download, reload and saved playback.
2. Select Smooth, start at 0.4 seconds and record both formats. Replay several cycles: inspect the join, ghosting and fine detail against Off. Try 0.1 and 0.8 seconds on slow and fast tile motion. Keep Off if a particular source looks better untreated.
3. Stop early, stop processing with Keep untreated, close during capture and background the tab. Confirm truthful partial/fallback handling and that the next recording works. Simulate an upload failure; download the offered recovery file before closing the tile.
4. On a saved clip, disable Loop, let it end and change a visual parameter. It should stay ended. Enable Loop to restart; check global pause/resume and explicit per-tile pause.
5. Repeat panel interaction at phone widths and on actual mobile hardware: no horizontal overflow, reachable options, disabled busy controls, readable progress and scrolling. Include a high resolution 30-second Smooth capture on your iMac.
6. Delete a test Smooth tile; verify its local processed and source files are removed. Screenshots and regular mood tiles should behave as before.

The user subsequently authorized Phase A production testing. Keep Off as default; approve actual content quality before expanding this export workflow in B/C.

## Next integrations

**B — Inspector trim:** only video capture tiles, never screenshots or regular mood tiles. Follow [the supplied reference](trim-reference.png): dark track, solid cyan selected range, slim cyan flags/handles, start/end/total time labels, no thumbnail strip. The visible handles stay minimal; invisible touch areas are at least 44 pixels. Add keyboard adjustment, separate accessible Start/End controls, clamping/minimum duration, Reset and exact timestamps. Persist non-destructive source-relative trim metadata. Preview must use the same selected interval as export. Arbitrary trim changes the loop boundary, so it must invalidate an old Smooth join and regenerate it later from the chosen interval. Do not claim a trimmed clip remains seamless.

**C — Edited exports and regression:** provide Original / Edited actions, visibly distinguish requested trim duration from loop overlap, derive exports from the retained master once, validate MP4/WebM timing and dimensions, and complete desktop/mobile end-to-end checks. Old captured videos without provenance remain playable and downloadable; future editing must explicitly handle their missing untreated master. Add upload cleanup/retry for both files and longer/high resolution quality checks as part of this phase.

**Optional later, after A–C and wider roadmap phases 5/6:** five simple intro/outro presets: Fade, Spin + zoom, Center zoom in, Center zoom out, and Slide. Include None by default, preview, short duration control and reduced-motion consideration. Apply these at final export from the source; do not bake repeated effects into loop playback. One-shot intro/outro and Smooth looping must have explicit compatibility rules. This is deferred, not implemented in Phase A.

## Production deployment

The npm prebuild hook runs pending schema migrations only in Vercel production builds. A missing DATABASE_URL or migration failure stops the build before the new deployment is promoted. The capture migration adds a nullable JSONB column; it does not reseed or delete data. Migration is separate from the local launcher. The local launcher now pins APP_URL to localhost so a production .env.local origin cannot redirect local verification links.
