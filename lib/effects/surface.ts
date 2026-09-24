/** Shared bounded presentation dimensions for media and sandbox VFX. */
export function effectSize(width: number, height: number, pixelRatio = 1): [number, number] {
  const ratio = Math.min(2, Math.max(1, pixelRatio || 1));
  const w = Math.max(1, Math.round(width * ratio));
  const h = Math.max(1, Math.round(height * ratio));
  const fit = Math.min(1, 2048 / Math.max(w, h), Math.sqrt(2_097_152 / (w * h)));
  // Floor, rather than round, so the bounded pixel area cannot creep one
  // row above the transport cap on near-square aspect ratios.
  return [Math.max(1, Math.floor(w * fit)), Math.max(1, Math.floor(h * fit))];
}

export function copySurface(source: CanvasImageSource, dest: HTMLCanvasElement, w: number, h: number): void {
  if (dest.width !== w || dest.height !== h) { dest.width = w; dest.height = h; }
  const ctx = dest.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'copy';
  ctx.drawImage(source, 0, 0, w, h);
  ctx.globalCompositeOperation = 'source-over';
}
