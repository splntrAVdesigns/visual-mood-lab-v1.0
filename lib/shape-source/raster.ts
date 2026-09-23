/**
 * Shape Source — shape spec and coverage rasteriser.
 *
 * A ShapeSpec describes WHAT the shape is (typed text, a library shape, an
 * uploaded file). rasterizeCoverage() turns it into an antialiased 0..255
 * coverage raster at SHAPE_RES², which sdf.ts turns into a distance field.
 *
 * Layout convention shared with the shader: the shape is fitted ("contain")
 * inside the central FIT fraction of a square raster, so there is always a
 * margin for the distance field to fall off into and for motion to displace
 * into without clipping.
 *
 * Location: lib/shape-source/raster.ts
 */

import { loadShapeFont } from './fonts';
import { LIBRARY_SHAPES, DEFAULT_LIBRARY_ID } from './library';

/** Raster / distance-field resolution. 1024 keeps edges clean when the
    shape is magnified onto a fullscreen tile (512 visibly stair-stepped). */
export const SHAPE_RES = 1024;
const FIT = 0.86;

export type ShapeKey = 'auto' | 'alpha' | 'luma';

export type ShapeSpec =
  | { kind: 'text'; text: string; fontId: string; upper: boolean; justify: boolean; leading: number }
  | { kind: 'library'; id: string }
  | { kind: 'file'; url: string; key: ShapeKey; threshold: number; invert: boolean }
  | { kind: 'empty' };

/** Stable cache key — two tiles with identical sources share one texture. */
export function specKey(spec: ShapeSpec): string {
  switch (spec.kind) {
    case 'text':
      return `t|${spec.fontId}|${spec.upper ? 1 : 0}|${spec.justify ? 1 : 0}|${spec.leading.toFixed(2)}|${spec.text}`;
    case 'library':
      return `l|${spec.id}`;
    case 'file':
      return `f|${spec.key}|${spec.threshold.toFixed(2)}|${spec.invert ? 1 : 0}|${spec.url}`;
    case 'empty':
      return 'e';
  }
}

function makeCanvas(): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = SHAPE_RES;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('2D canvas unavailable');
  return { canvas, ctx };
}

function alphaOf(ctx: CanvasRenderingContext2D): Uint8ClampedArray {
  const px = ctx.getImageData(0, 0, SHAPE_RES, SHAPE_RES).data;
  const out = new Uint8ClampedArray(SHAPE_RES * SHAPE_RES);
  for (let i = 0, j = 3; i < out.length; i++, j += 4) out[i] = px[j];
  return out;
}

/* ------------------------------------------------------------------ *
 * Text: every space starts a new line; each line can be justified to width
 * ------------------------------------------------------------------ */

async function rasterText(spec: Extract<ShapeSpec, { kind: 'text' }>): Promise<Uint8ClampedArray> {
  const { ctx } = makeCanvas();
  let text = spec.text.trim();
  if (spec.upper) text = text.toUpperCase();
  const words = text.split(/\s+/).filter(Boolean).slice(0, 24);

  if (words.length === 0) {
    // Empty text still renders something coherent rather than a blank tile.
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(SHAPE_RES / 2, SHAPE_RES / 2, SHAPE_RES * 0.3, 0, Math.PI * 2);
    ctx.fill();
    return alphaOf(ctx);
  }

  const font = await loadShapeFont(spec.fontId);
  const REF = 200;
  const W = SHAPE_RES * FIT;
  const H = SHAPE_RES * FIT;
  const lead = Math.min(1.6, Math.max(0.5, spec.leading));
  ctx.font = `${font.weight} ${REF}px "${font.family}", sans-serif`;
  ctx.textBaseline = 'alphabetic';

  const lines = words.map((w) => {
    const m = ctx.measureText(w);
    const width = Math.max(1, m.actualBoundingBoxLeft + m.actualBoundingBoxRight);
    return {
      w,
      width,
      left: m.actualBoundingBoxLeft,
      asc: Math.max(1, m.actualBoundingBoxAscent),
      desc: Math.max(0, m.actualBoundingBoxDescent),
    };
  });

  const uniform = Math.min(...lines.map((l) => W / l.width));
  const scales = lines.map((l) => (spec.justify ? W / l.width : uniform));
  const gap = REF * 0.08;

  let total = 0;
  lines.forEach((l, i) => {
    total += (l.asc + l.desc) * scales[i] * lead;
    if (i < lines.length - 1) total += gap * scales[i] * lead;
  });
  const fit = Math.min(1, H / Math.max(total, 1));

  ctx.fillStyle = '#fff';
  let y = (SHAPE_RES - total * fit) / 2;
  lines.forEach((l, i) => {
    const sc = scales[i] * fit;
    y += l.asc * sc * lead;
    ctx.save();
    ctx.translate(SHAPE_RES / 2 - (l.width * sc) / 2 + l.left * sc, y);
    ctx.scale(sc, sc);
    ctx.fillText(l.w, 0, 0);
    ctx.restore();
    y += l.desc * sc * lead + (i < lines.length - 1 ? gap * sc * lead : 0);
  });

  return alphaOf(ctx);
}

/* ------------------------------------------------------------------ *
 * Images and SVG
 * ------------------------------------------------------------------ */

function loadImage(url: string, cors: boolean): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (cors) img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not decode the shape image'));
    img.src = url;
  });
}

export interface Rect { x0: number; y0: number; x1: number; y1: number }

function drawContain(ctx: CanvasRenderingContext2D, img: HTMLImageElement): Rect {
  const iw = img.naturalWidth || img.width || SHAPE_RES;
  const ih = img.naturalHeight || img.height || SHAPE_RES;
  const s = Math.min((SHAPE_RES * FIT) / iw, (SHAPE_RES * FIT) / ih);
  const x = (SHAPE_RES - iw * s) / 2;
  const y = (SHAPE_RES - ih * s) / 2;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, x, y, iw * s, ih * s);
  return { x0: Math.ceil(x), y0: Math.ceil(y), x1: Math.floor(x + iw * s), y1: Math.floor(y + ih * s) };
}

async function rasterSvgText(svg: string): Promise<Uint8ClampedArray> {
  const { ctx } = makeCanvas();
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    drawContain(ctx, await loadImage(url, false));
  } finally {
    URL.revokeObjectURL(url);
  }
  return alphaOf(ctx);
}

/** Linear ramp centred on `t`: keeps antialiasing while moving the edge. */
function ramp(v: number, t: number): number {
  const w = 0.06;
  return Math.max(0, Math.min(1, (v - (t - w)) / (2 * w)));
}

async function rasterFile(spec: Extract<ShapeSpec, { kind: 'file' }>): Promise<Uint8ClampedArray> {
  const { ctx } = makeCanvas();
  const rect = drawContain(ctx, await loadImage(spec.url, !spec.url.startsWith('blob:') && !spec.url.startsWith('data:')));
  const px = ctx.getImageData(0, 0, SHAPE_RES, SHAPE_RES).data;
  return keyCoverage(px, SHAPE_RES, rect, spec.key, spec.threshold, spec.invert);
}

/**
 * RGBA pixels (square, `res`², image fitted inside `rect`) -> 0..1 coverage
 * as 0..255. Pure, so scripts/verify-shape-source.ts can exercise it without
 * a DOM.
 *
 * AUTO picks Alpha when the image's own frame has transparency, else
 * Luminance (100.0 scanned the whole raster, whose transparent fit margin
 * made every opaque JPG/PNG look transparent).
 *
 * ALPHA (100.3): the silhouette is the alpha channel, and Threshold trims it
 * BY BRIGHTNESS. A clean cutout's alpha is 0 or 1 everywhere except its 1-2
 * px antialiased edge, so the 100.0 alpha ramp moved coverage by ~1.4 % across
 * the whole slider — Threshold read as dead, and Alpha looked identical to
 * Auto. Now the centre (0.5) keeps the whole silhouette, left of centre trims
 * the lighter parts of the image away, right of centre trims the darker parts.
 *
 * LUMINANCE: ink is whatever contrasts with the ground; Threshold is the
 * brightness cut. The ground is read from the image border — and, 100.3, when
 * that border is TRANSPARENT the ground is taken as the opposite of the
 * image's own average ink brightness. 100.0 counted transparent as light
 * paper, so every light or mid-tone logo on a transparent PNG keyed to
 * nothing at all (the "Luminance makes my upload disappear" bug).
 */
export function keyCoverage(
  px: Uint8ClampedArray,
  res: number,
  rect: Rect,
  keyMode: ShapeKey,
  threshold: number,
  invert: boolean,
): Uint8ClampedArray {
  const n = res * res;
  const lumAt = (j: number) => (0.299 * px[j] + 0.587 * px[j + 1] + 0.114 * px[j + 2]) / 255;

  let transparent = 0, opaque = 0, inkSum = 0, inkN = 0;
  for (let y = rect.y0; y < rect.y1; y += 2) {
    for (let x = rect.x0; x < rect.x1; x += 2) {
      const j = (y * res + x) * 4;
      if (px[j + 3] < 250) transparent++; else opaque++;
      if (px[j + 3] > 128) { inkSum += lumAt(j); inkN++; }
    }
  }
  const hasAlpha = transparent > (transparent + opaque) * 0.005;
  const key = keyMode === 'auto' ? (hasAlpha ? 'alpha' : 'luma') : keyMode;

  // Ground brightness from the frame border; transparent border samples are
  // counted separately and, if they dominate, the ground is inferred from the
  // ink instead (dark ink -> light ground and vice versa).
  let borderSum = 0, borderN = 0, borderClear = 0;
  const sample = (x: number, y: number) => {
    const j = (y * res + x) * 4;
    if (px[j + 3] > 8) { borderSum += lumAt(j); borderN++; } else borderClear++;
  };
  for (let x = rect.x0; x < rect.x1; x += 4) { sample(x, rect.y0); sample(x, rect.y1 - 1); }
  for (let y = rect.y0; y < rect.y1; y += 4) { sample(rect.x0, y); sample(rect.x1 - 1, y); }
  const inkMean = inkN > 0 ? inkSum / inkN : 0;
  const lightGround = borderClear > borderN
    ? inkMean < 0.5
    : borderN === 0 || borderSum / borderN >= 0.5;

  // Alpha-mode brightness trim. The 1.12 / 0.12 stretch puts the cut just
  // outside 0..1 at the centre, so 0.5 keeps even pure white / pure black
  // whole and the slider is continuous through it.
  const trimLight = threshold < 0.5;
  const cut = trimLight ? (threshold / 0.5) * 1.12 : ((threshold - 0.5) / 0.5) * 1.12 - 0.12;

  const out = new Uint8ClampedArray(n);
  for (let i = 0, j = 0; i < n; i++, j += 4) {
    const a = px[j + 3] / 255;
    let c: number;
    if (key === 'alpha') {
      const lum = lumAt(j);
      const keep = trimLight ? ramp(1 - lum, 1 - cut) : ramp(lum, cut);
      c = ramp(a, 0.5) * keep;
    } else {
      // Ink = whatever contrasts with the ground. Threshold is the brightness
      // cut: pixels darker (light ground) or brighter (dark ground) than it.
      const lum = lumAt(j);
      c = a > 0.03 ? (lightGround ? ramp(1 - lum, 1 - threshold) : ramp(lum, threshold)) : 0;
    }
    if (invert) {
      // Invert inside the image's own frame only — flipping the margin too
      // would turn every inverted shape into a filled square.
      const x = i % res;
      const y = (i - x) / res;
      c = x >= rect.x0 && x < rect.x1 && y >= rect.y0 && y < rect.y1 ? 1 - c : 0;
    }
    out[i] = Math.round(c * 255);
  }
  return out;
}

export async function rasterizeCoverage(spec: ShapeSpec): Promise<Uint8ClampedArray> {
  switch (spec.kind) {
    case 'text':
      return rasterText(spec);
    case 'library':
      return rasterSvgText((LIBRARY_SHAPES[spec.id] ?? LIBRARY_SHAPES[DEFAULT_LIBRARY_ID]).svg);
    case 'file':
      return rasterFile(spec);
    case 'empty':
      return new Uint8ClampedArray(SHAPE_RES * SHAPE_RES);
  }
}
