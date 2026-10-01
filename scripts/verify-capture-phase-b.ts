import assert from 'node:assert/strict';
import { captureTrimSchema } from '../lib/capture/trim-validation';
import { clampTrim, isVideoCapture, trimTime } from '../lib/capture/trim';
assert(isVideoCapture({ type: 'video', tags: ['capture'] }));
for (const a of [{type:'image',tags:['capture']},{type:'video',tags:[]},{type:'shader',tags:[]}]) assert(!isVideoCapture(a));
for (const bad of [
 { startSec: -1, endSec: 2, sourceDurationSec: 5 },
 { startSec: 2, endSec: 1, sourceDurationSec: 5 },
 { startSec: 0, endSec: 6, sourceDurationSec: 5 },
 { startSec: 0, endSec: 0.09, sourceDurationSec: 5 },
 { startSec: 0, endSec: Infinity, sourceDurationSec: 5 },
 { startSec: 0, endSec: 2, sourceDurationSec: 5, rawSrcUrl: 'changed' },
]) assert(!captureTrimSchema.safeParse(bad).success);
assert(captureTrimSchema.safeParse({ startSec: 0.5, endSec: 1.5, sourceDurationSec: 5 }).success);
assert(captureTrimSchema.safeParse({ startSec: 0, endSec: 0.05, sourceDurationSec: 0.05 }).success);
assert.deepEqual(clampTrim(-2, 99, 5), {startSec:0,endSec:5,sourceDurationSec:5});
assert.equal(trimTime(59.999), '1:00.00');
console.log('Phase B capture scope, finite bounds, minimum range, and timestamp checks passed.');
