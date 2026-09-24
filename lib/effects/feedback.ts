/** Exponential history retention: identical elapsed-time response at 30/60/120Hz.
 * 0.85 at 60Hz is the reference. Large gaps are reset by the caller. */
export function feedbackWeights(delta: number): { retain: number; inject: number } {
  const seconds=Number.isFinite(delta)?Math.max(0,Math.min(delta,0.25)):1/60;
  const retain=Math.pow(0.85,seconds*60);
  return {retain,inject:1-retain};
}
