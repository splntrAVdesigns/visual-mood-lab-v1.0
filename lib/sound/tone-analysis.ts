/** Pure dominant-frequency extraction for shader excitation. This estimates
 * the strongest spectral component, not the fundamental pitch of polyphonic music.
 * dB magnitudes come from an optional 4096-point analyser; old 64-bin consumers
 * and the 256-sample waveform bridge keep their existing buffers. */
export interface ToneSample { frequency: number; energy: number }
export function dominantTone(db: Float32Array, sampleRate: number, fftSize: number): ToneSample | null {
  const hz = sampleRate / fftSize;
  const first = Math.max(1, Math.ceil(55 / hz));
  const last = Math.min(db.length - 2, Math.floor(6000 / hz));
  let peak = -Infinity, index = -1;
  for (let i = first; i <= last; i++) {
    if (Number.isFinite(db[i]) && db[i] > peak) { peak = db[i]; index = i; }
  }
  if (index < 0 || peak < -75) return null;
  const a = db[index - 1], b = db[index], c = db[index + 1];
  const denominator = a - 2 * b + c;
  const offset = Number.isFinite(denominator) && denominator < -0.0001
    ? Math.max(-0.5, Math.min(0.5, 0.5 * (a - c) / denominator)) : 0;
  return {
    frequency: Math.max(55, Math.min(6000, (index + offset) * hz)),
    energy: Math.max(0, Math.min(1, (peak + 75) / 65)),
  };
}
