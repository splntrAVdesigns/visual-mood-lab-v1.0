import { analyzeTempoFromChannels, type BpmDetectionResult } from './BpmDetector';

// Sprint B: moves the BPM autocorrelation — the actual multi-hundred-ms
// main-thread hitch on track load — off the main thread. BpmDetector.ts is
// pure math with no DOM/AudioContext dependency (its own comment already
// flagged it as "safe to move into the render/audio worker later"), so it
// runs unmodified here; this file is just the message-passing shell.
//
// Typed as a narrow interface rather than relying on the ambient
// DedicatedWorkerGlobalScope/"webworker" lib, since the project's single
// root tsconfig already sets `lib: ["ES2022","DOM","DOM.Iterable"]` and
// adding "webworker" there would apply to every file, not just this one.

export interface BpmWorkerRequest {
  id: number;
  channels: Float32Array[];
  sampleRate: number;
}

export interface BpmWorkerResponse {
  id: number;
  result: BpmDetectionResult | null;
  error?: string;
}

interface WorkerContext {
  onmessage: ((event: { data: BpmWorkerRequest }) => void) | null;
  postMessage: (message: BpmWorkerResponse) => void;
}

const ctx = self as unknown as WorkerContext;

ctx.onmessage = (event) => {
  const { id, channels, sampleRate } = event.data;
  try {
    const result = analyzeTempoFromChannels(channels, sampleRate);
    ctx.postMessage({ id, result });
  } catch (error) {
    ctx.postMessage({
      id,
      result: null,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
