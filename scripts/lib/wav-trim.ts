/**
 * Visual Mood Lab — WAV silence trimming for sample-backed sound presets.
 *
 * Node-only. Deliberately lives under scripts/, not lib/sound/ — lib/sound/
 * is imported by browser code (engine.ts, pad.ts, sample-cache.ts), and
 * pulling `node:fs` into that graph would break the client bundle. If a
 * future ingest step needs this logic, import it from here explicitly
 * rather than moving it into lib/sound/.
 *
 * Why hand-rolled rather than an npm WAV library: every sample currently in
 * public/sounds/ is either 24-bit PCM or 32-bit IEEE float, both of which
 * are a couple dozen lines each to decode/encode correctly. That's a
 * narrower, easier-to-audit surface than adding a dependency for a script
 * that runs a handful of times, and it means the trim path never
 * round-trips through a bit depth we didn't intend — see TRIM below,
 * which slices the original bytes directly rather than decoding and
 * re-encoding the audio that survives the cut.
 *
 * Location: scripts/lib/wav-trim.ts
 */

import { readFileSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';

interface RiffChunk {
  id: string;
  offset: number; // start of chunk DATA, i.e. past the 8-byte id+size header
  size: number;
}

interface WavFormat {
  audioFormat: number; // 1 = PCM int, 3 = IEEE float, 0xFFFE = extensible
  isFloat: boolean;
  channels: number;
  sampleRate: number;
  bitsPerSample: number;
  blockAlign: number;
  bytesPerSample: number;
}

export interface TrimResult {
  file: string;
  skipped: boolean;
  reason?: string;
  originalDurationS: number;
  trimmedDurationS: number;
  trimmedFromStartS: number;
  trimmedFromEndS: number;
  loopMismatch: {
    /** 0..1, roughly "fraction of full scale" per-channel worst-case
        difference between the new first frame and the new last frame. A
        genuinely closed loop (the sample was recorded/exported to already
        loop cleanly) lands near 0. Anything past LOOP_MISMATCH_WARN_AT is
        surfaced as a warning, not auto-corrected — see the module doc. */
    diff: number;
    warning: boolean;
  } | null;
  bytesWritten?: number;
}

/** -50dBFS. Below this counts as silence for trim purposes — quiet room
    tone/dither, not audio. Chosen to be well under any real note's
    sustain/release tail so a trim doesn't eat the last few percent of a
    natural decay. */
const DEFAULT_THRESHOLD_DB = -50;
/** Kept on each side of the detected boundary so a trim can't clip the
    very onset of an attack transient that happens to start just below
    threshold. */
const DEFAULT_PAD_MS = 8;
/** Above this per-channel amplitude difference between the new loop start
    and end frame, flag a loop-phase mismatch warning. 0.12 is roughly
    -18dBFS of discontinuity — audible as a click on loop if left alone. */
const LOOP_MISMATCH_WARN_AT = 0.12;

function readAscii(buf: Buffer, offset: number, length: number): string {
  return buf.toString('ascii', offset, offset + length);
}

/** Generic RIFF chunk walker. The samples in this project include a JUNK
    padding chunk before fmt (common from some DAW exporters), so this
    cannot assume fixed offsets — every chunk must be found by walking id
    + size pairs, respecting the mandatory even-byte padding on odd-sized
    chunks. */
function walkChunks(buf: Buffer): Map<string, RiffChunk> {
  if (readAscii(buf, 0, 4) !== 'RIFF' || readAscii(buf, 8, 4) !== 'WAVE') {
    throw new Error('not a RIFF/WAVE file');
  }
  const chunks = new Map<string, RiffChunk>();
  let pos = 12;
  while (pos + 8 <= buf.length) {
    const id = readAscii(buf, pos, 4);
    const size = buf.readUInt32LE(pos + 4);
    chunks.set(id, { id, offset: pos + 8, size });
    pos += 8 + size + (size % 2); // chunks are word-aligned
  }
  return chunks;
}

function readFormat(buf: Buffer, fmtChunk: RiffChunk): WavFormat {
  const audioFormatRaw = buf.readUInt16LE(fmtChunk.offset);
  const channels = buf.readUInt16LE(fmtChunk.offset + 2);
  const sampleRate = buf.readUInt32LE(fmtChunk.offset + 4);
  const blockAlign = buf.readUInt16LE(fmtChunk.offset + 12);
  const bitsPerSample = buf.readUInt16LE(fmtChunk.offset + 14);

  let audioFormat = audioFormatRaw;
  if (audioFormatRaw === 0xfffe) {
    // WAVE_FORMAT_EXTENSIBLE: real format lives in the first two bytes of
    // the subformat GUID, 24 bytes into the extension block.
    const subFormatOffset = fmtChunk.offset + 24;
    if (subFormatOffset + 2 <= fmtChunk.offset + fmtChunk.size) {
      audioFormat = buf.readUInt16LE(subFormatOffset);
    }
  }

  const isFloat = audioFormat === 3;
  if (audioFormat !== 1 && audioFormat !== 3) {
    throw new Error(`unsupported WAV audioFormat ${audioFormat} (only PCM int and IEEE float are handled)`);
  }

  return {
    audioFormat,
    isFloat,
    channels,
    sampleRate,
    bitsPerSample,
    blockAlign,
    bytesPerSample: bitsPerSample / 8,
  };
}

/** Reads one channel's sample at a given frame as a float in roughly
    -1..1, regardless of underlying bit depth/format. Used only for
    analysis (silence detection, loop-mismatch check) — the actual trim
    below slices raw bytes rather than round-tripping through this. */
function readSample(buf: Buffer, byteOffset: number, fmt: WavFormat): number {
  if (fmt.isFloat) return buf.readFloatLE(byteOffset);
  switch (fmt.bitsPerSample) {
    case 8:
      return (buf.readUInt8(byteOffset) - 128) / 128;
    case 16:
      return buf.readInt16LE(byteOffset) / 32768;
    case 24: {
      // Node has no native 24-bit read; sign-extend by hand.
      const b0 = buf[byteOffset];
      const b1 = buf[byteOffset + 1];
      const b2 = buf[byteOffset + 2];
      let v = b0 | (b1 << 8) | (b2 << 16);
      if (v & 0x800000) v |= ~0xffffff; // sign-extend into a JS 32-bit int
      return v / 8388608;
    }
    case 32:
      return buf.readInt32LE(byteOffset) / 2147483648;
    default:
      throw new Error(`unsupported bitsPerSample ${fmt.bitsPerSample}`);
  }
}

/** Peak absolute amplitude across all channels at a given frame index. */
function frameAmplitude(buf: Buffer, dataOffset: number, frameIndex: number, fmt: WavFormat): number {
  const frameByteOffset = dataOffset + frameIndex * fmt.blockAlign;
  let peak = 0;
  for (let ch = 0; ch < fmt.channels; ch++) {
    const s = Math.abs(readSample(buf, frameByteOffset + ch * fmt.bytesPerSample, fmt));
    if (s > peak) peak = s;
  }
  return peak;
}

function dbToLinear(db: number): number {
  return Math.pow(10, db / 20);
}

export interface TrimOptions {
  thresholdDb?: number;
  padMs?: number;
  /** Report and modify nothing — the default, since this touches committed
      binary assets. Pass write: true to actually rewrite the file. */
  write?: boolean;
  /** Keep a .orig.wav backup next to the file before overwriting. Ignored
      when write is false. */
  backup?: boolean;
}

/**
 * Analyzes one WAV file for leading/trailing silence and, if write is set,
 * rewrites it trimmed. Always reports a loop-phase mismatch check
 * regardless of write, since that's informational either way — see the
 * module doc for why it's surfaced rather than auto-corrected.
 */
export function trimSilence(filePath: string, opts: TrimOptions = {}): TrimResult {
  const thresholdDb = opts.thresholdDb ?? DEFAULT_THRESHOLD_DB;
  const padMs = opts.padMs ?? DEFAULT_PAD_MS;
  const threshold = dbToLinear(thresholdDb);

  const buf = readFileSync(filePath);
  const chunks = walkChunks(buf);
  const fmtChunk = chunks.get('fmt ');
  const dataChunk = chunks.get('data');
  if (!fmtChunk || !dataChunk) {
    throw new Error(`${filePath}: missing fmt or data chunk`);
  }
  const fmt = readFormat(buf, fmtChunk);
  const totalFrames = Math.floor(dataChunk.size / fmt.blockAlign);
  const originalDurationS = totalFrames / fmt.sampleRate;

  let firstAudible = -1;
  for (let i = 0; i < totalFrames; i++) {
    if (frameAmplitude(buf, dataChunk.offset, i, fmt) > threshold) {
      firstAudible = i;
      break;
    }
  }
  if (firstAudible === -1) {
    return {
      file: filePath,
      skipped: true,
      reason: 'entire file is below the silence threshold — left untouched',
      originalDurationS,
      trimmedDurationS: originalDurationS,
      trimmedFromStartS: 0,
      trimmedFromEndS: 0,
      loopMismatch: null,
    };
  }
  let lastAudible = totalFrames - 1;
  for (let i = totalFrames - 1; i >= 0; i--) {
    if (frameAmplitude(buf, dataChunk.offset, i, fmt) > threshold) {
      lastAudible = i;
      break;
    }
  }

  const padFrames = Math.round((padMs / 1000) * fmt.sampleRate);
  const startFrame = Math.max(0, firstAudible - padFrames);
  const endFrame = Math.min(totalFrames - 1, lastAudible + padFrames);

  if (startFrame >= endFrame) {
    return {
      file: filePath,
      skipped: true,
      reason: 'detected audible region was degenerate after padding — left untouched',
      originalDurationS,
      trimmedDurationS: originalDurationS,
      trimmedFromStartS: 0,
      trimmedFromEndS: 0,
      loopMismatch: null,
    };
  }

  const trimmedFromStartS = startFrame / fmt.sampleRate;
  const trimmedFromEndS = (totalFrames - 1 - endFrame) / fmt.sampleRate;
  const trimmedFrameCount = endFrame - startFrame + 1;
  const trimmedDurationS = trimmedFrameCount / fmt.sampleRate;

  // Loop-phase check: how far apart are the (new) first and last frames,
  // per channel, worst case. A sample authored to loop cleanly will have
  // near-matching phase at both ends even after silence is stripped; one
  // that wasn't won't, and no amount of silence-trimming fixes that — see
  // module doc.
  let worstDiff = 0;
  const startByteOffset = dataChunk.offset + startFrame * fmt.blockAlign;
  const endByteOffset = dataChunk.offset + endFrame * fmt.blockAlign;
  for (let ch = 0; ch < fmt.channels; ch++) {
    const a = readSample(buf, startByteOffset + ch * fmt.bytesPerSample, fmt);
    const b = readSample(buf, endByteOffset + ch * fmt.bytesPerSample, fmt);
    const diff = Math.abs(a - b);
    if (diff > worstDiff) worstDiff = diff;
  }

  const result: TrimResult = {
    file: filePath,
    skipped: false,
    originalDurationS,
    trimmedDurationS,
    trimmedFromStartS,
    trimmedFromEndS,
    loopMismatch: { diff: worstDiff, warning: worstDiff > LOOP_MISMATCH_WARN_AT },
  };

  if (opts.write) {
    if (opts.backup !== false) {
      const backupPath = filePath.replace(/\.wav$/i, '.orig.wav');
      if (!existsSync(backupPath)) copyFileSync(filePath, backupPath);
    }
    const trimmedData = buf.subarray(startByteOffset, endByteOffset + fmt.blockAlign);
    const out = buildWav(buf, fmtChunk, trimmedData);
    writeFileSync(filePath, out);
    result.bytesWritten = out.length;
  }

  return result;
}

/** Rebuilds a minimal, canonical RIFF/WAVE file: the original fmt chunk
    verbatim (so bit depth/channels/rate are untouched) plus the trimmed
    data chunk. Deliberately drops any other chunks (JUNK, LIST, bext,
    etc.) present in the source — none of them affect playback, and
    carrying stale metadata (like an original-length bext duration) across
    a trim is worse than dropping it. */
function buildWav(original: Buffer, fmtChunk: RiffChunk, trimmedData: Buffer): Buffer {
  const fmtBytes = original.subarray(fmtChunk.offset, fmtChunk.offset + fmtChunk.size);
  const fmtChunkTotal = 8 + fmtBytes.length + (fmtBytes.length % 2);
  const dataChunkTotal = 8 + trimmedData.length + (trimmedData.length % 2);
  const riffSize = 4 + fmtChunkTotal + dataChunkTotal; // 'WAVE' + both chunks

  const out = Buffer.alloc(8 + riffSize);
  out.write('RIFF', 0, 'ascii');
  out.writeUInt32LE(riffSize, 4);
  out.write('WAVE', 8, 'ascii');

  let pos = 12;
  out.write('fmt ', pos, 'ascii');
  out.writeUInt32LE(fmtBytes.length, pos + 4);
  fmtBytes.copy(out, pos + 8);
  pos += fmtChunkTotal;

  out.write('data', pos, 'ascii');
  out.writeUInt32LE(trimmedData.length, pos + 4);
  trimmedData.copy(out, pos + 8);
  // Buffer.alloc already zero-fills, so odd-length padding byte is a no-op.

  return out;
}
