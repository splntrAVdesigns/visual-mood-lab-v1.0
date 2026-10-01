// Phase A: capture a raw master, then derive the Smooth loop sequentially.
// The live renderer and encoder quality remain independent of the edit pass.
import { Output, Mp4OutputFormat, WebMOutputFormat, BufferTarget, CanvasSource,
  Input, BlobSource, ALL_FORMATS, CanvasSink } from 'mediabunny';
import { encodableSize, resolveVideoCodec } from './support';
import { capturePlan, loopFrame } from './loop';
import type { CaptureOptions, CaptureListener, CaptureResult, CaptureMetadata } from './types';

const BITRATE = 8_000_000;
const MAX_BLOB_BYTES = 128 * 1024 * 1024;
// A hidden tab can suspend rAF entirely. The timeout lets stop/cancel release
// the encoder even when another animation frame never arrives.
const nextFrame = () => new Promise<number>((resolve) => {
  const frame = requestAnimationFrame((now) => { clearTimeout(timer); resolve(now); });
  const timer = setTimeout(() => { cancelAnimationFrame(frame); resolve(performance.now()); }, 100);
});

export async function startCapture(canvas: HTMLCanvasElement, options: CaptureOptions, notify?: CaptureListener) {
  if (typeof VideoEncoder === 'undefined' || typeof VideoFrame === 'undefined') throw new Error('Video export is not supported in this browser.');
  if (!canvas.width || !canvas.height) throw new Error('Tile is not ready to record.');
  const plan = capturePlan(options);
  const { fps, frames, overlap, rawFrames } = plan;
  const { width, height } = encodableSize(canvas.width, canvas.height);
  const codec = await resolveVideoCodec(options.format, width, height);
  if (!codec) throw new Error(`No supported ${options.format.toUpperCase()} encoder for ${width}×${height}.`);
  if (document.hidden) throw new Error('Keep this tab visible to start recording.');
  const mimeType = options.format === 'mp4' ? 'video/mp4' : 'video/webm';
  let stopped = false;
  let abandoned = false;
  let warning: string | undefined;
  const onHidden = () => { if (document.hidden) { stopped = true; warning = 'Recording interrupted — untreated source saved.'; } };
  document.addEventListener('visibilitychange', onHidden);
  const outputCanvas = document.createElement('canvas');
  outputCanvas.width = width; outputCanvas.height = height;
  const ctx = outputCanvas.getContext('2d');
  if (!ctx) { document.removeEventListener('visibilitychange', onHidden); throw new Error('Canvas unavailable'); }
  // Keep references narrowed across async closures.
  const context = ctx;
  const selectedCodec = codec;
  const makeOutput = () => {
    const target = new BufferTarget();
    const output = new Output({ format: options.format === 'mp4' ? new Mp4OutputFormat() : new WebMOutputFormat(), target });
    const source = new CanvasSource(outputCanvas, { codec: selectedCodec, bitrate: BITRATE });
    output.addVideoTrack(source, { frameRate: fps });
    return { output, target, source };
  };
  const raw = makeOutput();
  let activeOutput = raw.output;
  let input: Input | null = null;
  const add = (source: CanvasSource, index: number) => source.add(index / fps, 1 / fps, { keyFrame: index % 60 === 0 });
  const progress = (status: 'recording' | 'finalizing' | 'processing', elapsedSec: number, fraction?: number) =>
    notify?.({ status, elapsedSec, durationSec: rawFrames / fps, fraction });

  const result = (async (): Promise<CaptureResult> => {
    let count = 0;
    let repeatedFrames = 0;
    try {
      await raw.output.start();
      let start: number | null = null;
      progress('recording', 0);
      while (count < rawFrames && !stopped) {
        const now = await nextFrame();
        if (stopped) break;
        if (start === null) start = now;
        const due = Math.min(rawFrames - 1, Math.floor((now - start) * fps / 1000 + 0.05));
        if (due < count) continue;
        // Long suspension/load spikes yield an honest partial source, not a time-compressed loop.
        if (due - count > fps * 2 || !canvas.width || !canvas.height) {
          stopped = true; warning = 'Capture interrupted by a rendering delay — untreated source saved.'; break;
        }
        // Preserve elapsed time using the last sampled frame for missed slots.
        while (count > 0 && count < due) { await add(raw.source, count++); repeatedFrames++; }
        context.globalAlpha = 1;
        context.clearRect(0, 0, width, height);
        context.drawImage(canvas, 0, 0, canvas.width - canvas.width % 2, canvas.height - canvas.height % 2, 0, 0, width, height);
        await add(raw.source, count++);
        progress('recording', count / fps);
      }
      if (abandoned) throw new Error('Capture canceled');
      if (!count) throw new Error('Recording stopped before the first frame.');
      progress('finalizing', count / fps);
      raw.source.close();
      await raw.output.finalize();
      if (!raw.target.buffer) throw new Error('Export produced no data');
      const rawBlob = new Blob([raw.target.buffer], { type: mimeType });
      if (rawBlob.size > MAX_BLOB_BYTES) throw new Error('Capture exceeds the 128 MB processing limit.');
      const completed = !stopped && count === rawFrames;
      const metadata: CaptureMetadata = { version: 1, loopMode: 'off', overlapMs: 0,
        requestedDurationSec: options.durationSec, durationSec: count / fps, rawDurationSec: count / fps,
        fps, width, height, completed, repeatedFrames };
      let blob = rawBlob;
      if (completed && overlap) {
        try {
          input = new Input({ source: new BlobSource(rawBlob), formats: ALL_FORMATS });
          const track = await input.getPrimaryVideoTrack();
          if (!track || !(await track.canDecode())) throw new Error('Decoder unavailable');
          const main = new CanvasSink(track, { poolSize: 1 });
          const head = new CanvasSink(track, { poolSize: 1 });
          const times = function* (offset: number, length: number) { for (let i = 0; i < length; i++) yield (offset + i + 0.25) / fps; };
          const mainFrames = main.canvasesAtTimestamps(times(overlap, frames));
          const headFrames = head.canvasesAtTimestamps(times(0, overlap));
          const smooth = makeOutput(); activeOutput = smooth.output;
          try {
            await smooth.output.start();
            progress('processing', count / fps, 0);
            for (let i = 0; i < frames; i++) {
              if (stopped || abandoned) throw new Error('Processing stopped');
              const sourceFrame = (await mainFrames.next()).value;
              if (!sourceFrame) throw new Error('Missing source frame');
              context.globalAlpha = 1; context.clearRect(0, 0, width, height);
              context.drawImage(sourceFrame.canvas, 0, 0, width, height);
              const edit = loopFrame(i, frames, overlap);
              if (edit.head !== null) {
                const headFrame = (await headFrames.next()).value;
                if (!headFrame) throw new Error('Missing opening frame');
                context.globalAlpha = edit.alpha;
                context.drawImage(headFrame.canvas, 0, 0, width, height);
                context.globalAlpha = 1;
              }
              await add(smooth.source, i);
              if (i % 10 === 0) { progress('processing', count / fps, (i + 1) / frames); await new Promise(r => setTimeout(r, 0)); }
            }
            smooth.source.close(); await smooth.output.finalize();
            if (!smooth.target.buffer) throw new Error('No processed output');
            blob = new Blob([smooth.target.buffer], { type: mimeType });
            metadata.loopMode = 'smooth'; metadata.overlapMs = overlap / fps * 1000; metadata.durationSec = frames / fps;
          } finally {
            await mainFrames.return(); await headFrames.return();
          }
        } catch {
          await activeOutput.cancel().catch(() => {});
          warning = 'Smooth processing unavailable or stopped — untreated source saved instead.';
        }
      }
      if (abandoned) throw new Error('Capture canceled');
      if (!completed && !warning) warning = 'Stopped early — untreated source saved.';
      if (repeatedFrames && !warning) warning = `Clip saved; ${repeatedFrames} repeated frames compensated for capture load.`;
      return { blob, rawBlob, format: options.format, mimeType, durationSec: metadata.durationSec,
        looped: metadata.loopMode === 'smooth', metadata, warning };
    } catch (error) {
      await activeOutput.cancel().catch(() => {});
      throw error;
    } finally {
      input?.dispose();
      document.removeEventListener('visibilitychange', onHidden);
      outputCanvas.width = outputCanvas.height = 0;
    }
  })();
  return { result, stop: () => { stopped = true; }, cancel: () => { abandoned = true; stopped = true; } };
}
