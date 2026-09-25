# p5 sketch performance sprint — measurement gate

Baseline: GitHub `main` at `0168a02` (shared p5 VFX frame deduplication). This patch adds opt-in draw-loop and VFX bitmap-capture timings. It does not modify sketch geometry, counts, motion, or quality thresholds.

## Ten sketches, first pass

1. Rippling Table
2. HUD Array
3. Static Choir
4. Flow Field
5. Particle Detractor
6. Murmuration
7. Terrain Wireframe
8. Strange Attractor
9. Flocking
10. Shader Texture

## Capture method

Use desktop Chrome at the same window and tile size for every run. Open the deployed URL with `?perf=1`. Focus one sketch, let it settle for five seconds, then run `window.__vmlPerf.capture('Rippling Table / no VFX')` in the console. Wait 15 seconds for the result. Repeat for the nine remaining sketches, changing the label each time.

Next, enable the same three-effect chain on each sketch (Grain, Quad Mirror, Noise Displacement; keep the same mix and parameter settings). Wait for shader loading to finish before running `window.__vmlPerf.capture('Rippling Table / 3 VFX')`, and repeat across the ten sketches. Do not switch sketches, resize, or alter controls during a capture. The desktop comparison should use the same default sketch settings on both sides. Record a second high-density run only for a sketch that shows a plausible bottleneck.

After the first ten or all twenty runs, enter `window.__vmlPerf.download()` to save `vml-p5-performance.json` locally. Capture history lives only in the page; download before reloading or closing it. Send the file back for analysis. If a browser denies the file download, `window.__vmlPerf.runs()` displays the collected summaries.

## Read the numbers correctly

- `medianFps` and `p95FrameGapMs`: outer host loop; a consistent 30 FPS may reflect the existing p5 presentation cap, not a defect.
- `p5SketchFps`: iframe heartbeat FPS. Compare to the same sketch without VFX.
- `p5DrawP95Ms`: approximate upper-tail draw-call duration within the isolated iframe; based on the p95 of recent half-second draw windows. JS/GPU command submission only, not full GPU execution time.
- `p5CaptureP95Ms`: upper-tail time until the host-pulled ImageBitmap completes; can include GPU synchronization and event-loop delays. Expected only during VFX capture.
- `p95EffectsCpuMs`: host post-process CPU submission time; excludes asynchronous GPU completion.
- `effectsPasses`: maximum number of executed VFX passes observed during the capture; verify it stays three for the stacked run and zero without VFX.

The next tuning step depends on the measured bottleneck: high draw time suggests sketch changes, high bitmap-capture time suggests transport or GPU sync, and high effects time suggests effect pass or pixel-cost work. Confirm any candidate with a second measurement and a mobile visual check. No blanket density or frame-rate reduction should be applied to these ten.

## Status

Measurement instrumentation, safety bounds, unit checks and a production build are complete. An actual ten-sketch timing result is pending an authenticated browser run of the capture method above; this repository does not contain an authenticated local test database or an accessible browser session with the board open. The prior Particle Cube mobile result is separate and does not establish FPS for these ten sketches.
