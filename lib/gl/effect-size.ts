/** Choose one aspect-preserving resolution shared by GPU passes, CPU relay,
 * uniforms and echo. The presentation canvas keeps its own CSS dimensions. */
export function fitEffectToStage(width: number, height: number, capacityWidth: number, capacityHeight: number): [number, number] {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  const scale = Math.min(1, capacityWidth / w, capacityHeight / h);
  return [Math.max(1, Math.floor(w * scale)), Math.max(1, Math.floor(h * scale))];
}
