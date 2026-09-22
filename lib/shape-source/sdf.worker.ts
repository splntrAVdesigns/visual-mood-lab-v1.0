/**
 * Shape Source — distance-field worker.
 *
 * A 1024² distance transform is ~100 ms of CPU; on the main thread that is a
 * visible hitch every time someone types a letter into a text shape. The
 * worker keeps the render loop smooth; the result buffer is transferred, not
 * copied. lib/shape-source/index.ts falls back to the main thread if a
 * worker cannot be created.
 *
 * Location: lib/shape-source/sdf.worker.ts
 */

import { buildSdfRGBA } from './sdf';

interface Job {
  id: number;
  coverage: Uint8ClampedArray;
  width: number;
  height: number;
}

const scope = self as unknown as {
  onmessage: ((e: MessageEvent<Job>) => void) | null;
  postMessage: (message: unknown, transfer: Transferable[]) => void;
};

scope.onmessage = (e) => {
  const { id, coverage, width, height } = e.data;
  const result = buildSdfRGBA(coverage, width, height);
  scope.postMessage({ id, ...result }, [result.rgba.buffer]);
};
