import { Input, BlobSource, ALL_FORMATS, Output, BufferTarget, Mp4InputFormat, WebMInputFormat,
  Mp4OutputFormat, WebMOutputFormat, Conversion, Quality } from 'mediabunny';
import { resolveVideoCodec } from './support';
import type { CaptureTrim } from './trim';

/** Re-encode just the displayed source interval. Never reapply its original Smooth join. */
export async function exportTrimmedCapture(blob: Blob, trim: CaptureTrim, signal?: AbortSignal,
  progress?: (fraction: number) => void): Promise<{ blob: Blob; extension: 'mp4' | 'webm'; durationSec: number }> {
  const checkAbort = () => signal?.throwIfAborted();
  checkAbort();
  if (blob.size > 128 * 1024 * 1024) throw new Error('This capture is too large to trim in this browser.');
  if (typeof VideoEncoder === 'undefined' || typeof VideoDecoder === 'undefined') throw new Error('Trimmed export needs a browser with video encoding and decoding support.');
  const input = new Input({source:new BlobSource(blob),formats:ALL_FORMATS});
  let conversion: Conversion | undefined;
  let completed = false;
  const cancel = () => { void conversion?.cancel().catch(() => {}); };
  signal?.addEventListener('abort',cancel,{once:true});
  try {
    const format = await input.getFormat();
    const extension = format instanceof Mp4InputFormat ? 'mp4' : format instanceof WebMInputFormat ? 'webm' : null;
    if (!extension) throw new Error('Trimmed capture export supports MP4 and WebM.');
    const track = await input.getPrimaryVideoTrack();
    if (!track) throw new Error('Capture has no video track.');
    if ((await input.getAudioTracks()).length) throw new Error('This capture includes audio; synchronized audio trimming is not supported yet.');
    const duration = await input.computeDuration();
    const {startSec:start,endSec:end,sourceDurationSec} = trim;
    if (![start,end,sourceDurationSec].every(Number.isFinite) || start < 0 || end <= start || end > sourceDurationSec ||
      Math.abs(sourceDurationSec-duration) > .1 || end > duration+.001) throw new Error('The trim range does not match this saved clip. Reset trim and try again.');
    const codec = await resolveVideoCodec(extension,track.displayWidth,track.displayHeight);
    if (!codec) throw new Error(`This browser cannot encode trimmed ${extension.toUpperCase()}. The original capture is preserved.`);
    const stats = await track.computePacketStats();
    const fps = stats.averagePacketRate;
    if (!Number.isFinite(fps) || fps <= 0 || fps > 120) throw new Error('Cannot determine this capture’s frame rate.');
    checkAbort();
    const target = new BufferTarget();
    const output = new Output({format:extension==='mp4'?new Mp4OutputFormat():new WebMOutputFormat(),target});
    conversion = await Conversion.init({input,output,tracks:'primary',trim:{start,end},
      video:{codec,frameRate:fps,forceTranscode:true,quality:new Quality({bitrate:8_000_000}),
        process: sample => {
          const remaining = end-start-sample.timestamp;
          if (remaining <= 0) return null;
          sample.setDuration(Math.min(sample.duration, remaining));
          return sample;
        }},audio:{discard:true}});
    if (!conversion.isValid || conversion.discardedTracks.length) throw new Error('This browser cannot decode or encode this capture for trimming. The original capture is preserved.');
    conversion.onProgress = fraction => progress?.(Math.max(0,Math.min(1,fraction)));
    checkAbort();
    await conversion.execute();
    checkAbort();
    if (!target.buffer?.byteLength) throw new Error('Trimmed export produced no video.');
    completed = true;
    return {blob:new Blob([target.buffer],{type:extension==='mp4'?'video/mp4':'video/webm'}),extension,durationSec:end-start};
  } finally {
    signal?.removeEventListener('abort',cancel);
    if (conversion && !completed) await conversion.cancel().catch(() => {});
    input.dispose();
  }
}
