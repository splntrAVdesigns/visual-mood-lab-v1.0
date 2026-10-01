import assert from 'node:assert/strict';
import { capturePlan, loopFrame } from '../lib/capture/loop';
import { captureMetadataSchema } from '../lib/capture/metadata';
for (const durationSec of [5, 10, 30]) for (const overlapMs of [100, 400, 800]) {
  const p = capturePlan({ format: 'mp4', durationSec, loopMode: 'smooth', overlapMs });
  assert.equal(p.rawFrames - p.overlap, durationSec * 30);
  const first = loopFrame(0, p.frames, p.overlap);
  const last = loopFrame(p.frames - 1, p.frames, p.overlap);
  assert.equal(first.source, p.overlap);
  assert.equal(last.head! + 1, first.source, 'seam continues to the next head frame');
  assert.equal(last.alpha, 1);
  assert.equal(loopFrame(p.frames - p.overlap, p.frames, p.overlap).alpha, 0);
}
assert.equal(capturePlan({ format: 'webm', durationSec: 5, loopMode: 'off' }).rawFrames, 150);
assert.throws(() => capturePlan({ format: 'mp4', durationSec: 5, loopMode: 'smooth', fps: 2 }));
for (const n of [NaN, Infinity, 0, 31]) assert.throws(() => capturePlan({ format: 'mp4', durationSec: n }));
const metadata = { version: 1, loopMode: 'off', overlapMs: 0, requestedDurationSec: 5, durationSec: 1,
  rawDurationSec: 1, fps: 30, width: 640, height: 360, completed: false, repeatedFrames: 0 };
assert(captureMetadataSchema.safeParse(metadata).success);
assert(!captureMetadataSchema.safeParse({ ...metadata, loopMode: 'smooth' }).success);
assert(!captureMetadataSchema.safeParse({ ...metadata, width: -1 }).success);
assert(!captureMetadataSchema.safeParse({ ...metadata, extra: 'untrusted' }).success);
console.log('Phase A timing/overlap and metadata checks passed.');
