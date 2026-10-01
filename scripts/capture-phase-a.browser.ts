import { startCapture } from '../lib/capture/engine';
import { Input, BlobSource, ALL_FORMATS, CanvasSink, VideoSampleSink } from 'mediabunny';
import { MediaRenderer } from '../renderers/media.renderer';
import type { Asset } from '../types/asset';
const check = (ok: unknown, message: string) => { if (!ok) throw new Error(message); };
const delay = (ms: number) => new Promise(r => setTimeout(r, ms));
async function pixel(sink: CanvasSink, time: number) {
  const frame = await sink.getCanvas(time); check(frame, 'decoded frame missing');
  const c = document.createElement('canvas'); c.width = c.height = 1;
  const ctx = c.getContext('2d')!;
  ctx.drawImage(frame!.canvas, 10, 10, 1, 1, 0, 0, 1, 1);
  return ctx.getImageData(0, 0, 1, 1).data[0];
}
export async function run() {
  const reports: unknown[] = [];
  const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 360;
  document.body.append(canvas);
  const ctx = canvas.getContext('2d')!;
  let start = performance.now(), alive = true;
  function draw() {
    const level = Math.min(220, 30 + (performance.now() - start) / 40);
    ctx.fillStyle = `rgb(${level},${level},${level})`; ctx.fillRect(0, 0, 640, 360);
    ctx.fillStyle = '#04d9ff'; ctx.fillRect(100 + (performance.now() - start) / 30, 100, 3, 100);
    if (alive) requestAnimationFrame(draw);
  }
  draw();
  try {
    for (const format of ['mp4', 'webm'] as const) for (const loopMode of ['off', 'smooth'] as const) {
      start = performance.now();
      const handle = await startCapture(canvas, { format, loopMode, durationSec: 5, overlapMs: 400 });
      const result = await handle.result;
      check(result.metadata.completed, 'capture did not complete');
      check(result.metadata.loopMode === loopMode, `unexpected raw fallback: ${result.warning}`);
      const input = new Input({ source: new BlobSource(result.blob), formats: ALL_FORMATS });
      const raw = new Input({ source: new BlobSource(result.rawBlob), formats: ALL_FORMATS });
      try {
        const track = (await input.getPrimaryVideoTrack())!;
        check(Math.abs(await input.computeDuration() - 5) < 1 / 30, 'duration mismatch');
        let frameCount = 0;
        for await (const sample of new VideoSampleSink(track).samples()) { frameCount++; sample.close(); }
        check(frameCount === 150, `frame count ${frameCount}`);
        const out = new CanvasSink(track, { poolSize: 1 });
        const src = new CanvasSink((await raw.getPrimaryVideoTrack())!, { poolSize: 1 });
        let seamDelta: number | null = null, oldSeamDelta: number | null = null;
        if (loopMode === 'smooth') {
          const first = await pixel(out, 0.001), last = await pixel(out, 149 / 30 + 0.001);
          const expectedFirst = await pixel(src, 12 / 30 + 0.001), expectedLast = await pixel(src, 11 / 30 + 0.001);
          check(Math.abs(first - expectedFirst) <= 4 && Math.abs(last - expectedLast) <= 4, 'overlap endpoints mismatch');
          seamDelta = Math.abs(first - last);
          oldSeamDelta = Math.abs(expectedLast - await pixel(src, 0.001));
          check(seamDelta < oldSeamDelta, 'fixture seam is not improved');
        } else check(result.blob === result.rawBlob, 'Off must preserve original bytes');
        reports.push({ format, loopMode, bytes: result.blob.size, frameCount, seamDelta, oldSeamDelta, repeatedFrames: result.metadata.repeatedFrames });
      } finally { input.dispose(); raw.dispose(); }
    }
    start = performance.now();
    const partial = await startCapture(canvas, { format: 'webm', loopMode: 'smooth', durationSec: 5 });
    await delay(700); partial.stop();
    const stopped = await partial.result;
    check(!stopped.metadata.completed && !stopped.looped && stopped.rawBlob === stopped.blob, 'early stop must be untreated');
    const canceled = await startCapture(canvas, { format: 'webm', loopMode: 'off', durationSec: 5 });
    canceled.cancel();
    let canceledRejected = false;
    try { await canceled.result; } catch { canceledRejected = true; }
    check(canceledRejected, 'cancel must abandon the clip');
    let keepSource: (() => void) | undefined;
    const processingStopped = await startCapture(canvas, { format: 'mp4', loopMode: 'smooth', durationSec: 5 },
      progress => { if (progress.status === 'processing') keepSource?.(); });
    keepSource = processingStopped.stop;
    const fallback = await processingStopped.result;
    check(fallback.blob === fallback.rawBlob && !fallback.looped && !!fallback.warning,
      'stopping processing must retain the untreated source');
    const host = document.createElement('div'); document.body.append(host);
    const url = URL.createObjectURL(stopped.blob);
    const media = new MediaRenderer('fixture', 'video');
    await media.mount(host, { id: 'fixture', itemId: 'fixture', type: 'video', title: 'fixture', tags: [], srcUrl: url,
      params: { loop: false }, createdAt: '', updatedAt: '' } as Asset, new AbortController().signal);
    const video = host.querySelector('video')!;
    await new Promise<void>((resolve, reject) => { video.onended = () => resolve(); setTimeout(() => reject(new Error('video did not end')), 3000); });
    media.setParam('opacity', 0.5); await delay(100);
    check(video.ended && video.paused, 'Inspector edit restarted one-shot playback');
    media.setParam('loop', true); await delay(100); check(!video.paused, 'enabling loop failed to restart');
    media.pause(); media.setParam('opacity', 1); check(video.paused, 'global pause lost on edit');
    media.play(); await delay(100); check(!video.paused, 'global resume failed');
    media.dispose(); host.remove(); URL.revokeObjectURL(url);
    reports.push({ earlyStop: true, cancel: true, processingFallback: true, oneShot: true, loopRestart: true, globalPause: true });
    return reports;
  } finally { alive = false; canvas.remove(); }
}
