import assert from 'node:assert/strict';
import { beginFrameProfile, endFrameProfile, installFrameProfile, recordTileProfile } from '../lib/debug/frame-profile';

const inactive = { location: { search: '' } } as Window;
installFrameProfile(inactive);
assert.equal(inactive.__vmlPerf, undefined, 'profiling stays opt-in');
const win = { location: { search: '?perf=1' } } as Window;
installFrameProfile(win);
assert.ok(win.__vmlPerf);
for (let i = 0; i < 950; i++) {
  beginFrameProfile(i * 16);
  recordTileProfile({type:'p5',renderMs:1,effectsMs:2,passes:2,pixels:480000,p5Fps:30,focused:true,p5DrawP95Ms:3.5,p5CaptureP95Ms:1.2});
  endFrameProfile();
}
const frames = win.__vmlPerf.snapshot().frames;
assert.equal(frames.length, 900, 'bounded ring');
assert.equal(frames[0].gapMs, 16);
assert.equal(frames[0].tiles[0].passes, 2);
const summary = win.__vmlPerf.summary();
assert.equal(summary.medianFps, 63);
assert.equal(summary.p95FrameGapMs, 16);
assert.equal(summary.p5SketchFps, 30);
assert.equal(summary.effectsPasses, 2);
assert.equal(summary.p5DrawP95Ms, 3.5);
assert.equal(summary.p5CaptureP95Ms, 1.2);
frames[0].tiles[0].passes = 100;
assert.equal(win.__vmlPerf.snapshot().frames[0].tiles[0].passes, 2, 'snapshot cannot change ring');
win.__vmlPerf.reset();
assert.equal(win.__vmlPerf.snapshot().frames.length, 0);
assert.equal(win.__vmlPerf.summary().medianFps, null);
console.log('PASS opt-in frame profile, bounded ring, detached snapshot and reset');
