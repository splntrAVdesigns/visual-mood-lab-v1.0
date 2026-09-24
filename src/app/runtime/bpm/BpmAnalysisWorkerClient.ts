import { analyzeTempoFromChannels, type BpmDetectionResult } from './BpmDetector';
import type { BpmWorkerRequest, BpmWorkerResponse } from './bpmAnalysisWorker';

let worker: Worker | null = null;
let workerCreationFailed = false;
let nextRequestId = 1;
const pending = new Map<number, (result: BpmDetectionResult | null) => void>();

function resolveAllPending(result: BpmDetectionResult | null): void {
  for (const [id, resolve] of pending) {
    resolve(result);
    pending.delete(id);
  }
}

function ensureWorker(): Worker | null {
  if (worker || workerCreationFailed) return worker;
  if (typeof Worker === 'undefined') {
    workerCreationFailed = true;
    return null;
  }
  try {
    worker = new Worker(new URL('./bpmAnalysisWorker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent<BpmWorkerResponse>) => {
      const { id, result } = event.data;
      const resolve = pending.get(id);
      if (!resolve) return;
      pending.delete(id);
      resolve(result);
    };
    worker.onerror = (event) => {
      // A worker-level failure (e.g. an unusual host that blocks module
      // workers despite `typeof Worker !== 'undefined'`) must not strand
      // callers already waiting on a response, and must not permanently
      // disable BPM detection for the rest of the session — later calls
      // fall back to the main-thread path once the worker is torn down.
      console.warn('[ORBITAL audio] BPM analysis worker error, falling back to main thread:', event.message);
      resolveAllPending(null);
      worker?.terminate();
      worker = null;
    };
  } catch (error) {
    console.warn('[ORBITAL audio] BPM analysis worker unavailable, using main thread:', error);
    workerCreationFailed = true;
    worker = null;
  }
  return worker;
}

/**
 * Runs the BPM autocorrelation off the main thread when a Worker is
 * available, falling back to the identical in-process computation
 * otherwise (old browsers, or a host that restricts module workers). The
 * channel data is copied — not the original AudioBuffer-backed views some
 * browsers refuse to detach — so the copies' buffers can be transferred to
 * the worker at zero extra copy cost for the postMessage call itself.
 */
export async function runBpmAnalysis(
  channels: readonly Float32Array[],
  sampleRate: number,
): Promise<BpmDetectionResult | null> {
  const activeWorker = ensureWorker();
  if (!activeWorker) {
    return analyzeTempoFromChannels(channels, sampleRate);
  }

  const copies = channels.map((channel) => channel.slice());
  const id = nextRequestId++;
  const request: BpmWorkerRequest = { id, channels: copies, sampleRate };

  return new Promise<BpmDetectionResult | null>((resolve) => {
    pending.set(id, resolve);
    try {
      activeWorker.postMessage(request, copies.map((copy) => copy.buffer));
    } catch (error) {
      pending.delete(id);
      console.warn('[ORBITAL audio] BPM analysis worker postMessage failed, using main thread:', error);
      resolve(analyzeTempoFromChannels(channels, sampleRate));
    }
  });
}

/** Terminates the shared worker, if one was created. Safe to call repeatedly. */
export function terminateBpmAnalysisWorker(): void {
  if (!worker) return;
  resolveAllPending(null);
  worker.terminate();
  worker = null;
}
