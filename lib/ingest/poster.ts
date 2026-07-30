import { createHash } from 'node:crypto';
import type { AssetType } from '@/types/asset';

/**
 * Placeholder posters for code assets.
 *
 * Shaders and sketches cannot produce a real poster until the renderer exists
 * (Phase 2), so Phase 1 generates a deterministic one from the content hash.
 * Deterministic matters: the same source always yields the same poster, so
 * re-running the seed script does not churn storage, and a card does not
 * change appearance between rebuilds for no reason.
 *
 * Phase 2 ships `scripts/backfill-posters.ts`, which re-renders these for
 * real and overwrites them. Nothing else changes — the poster URL is already
 * in the right column.
 */

const PALETTE = {
  bg: '#000000',
  surface: '#16161a',
  line: '#262629',
  dim: '#45454c',
  accent: '#00d3ff',
} as const;

/** Small deterministic PRNG so one hash drives every random choice. */
function rng(seed: string): () => number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (Math.imul(31, h) + seed.charCodeAt(i)) | 0;
  return () => {
    h = (Math.imul(h ^ (h >>> 15), 1 | h) + 0x6d2b79f5) | 0;
    let t = (h ^ (h >>> 7)) >>> 0;
    t = Math.imul(t ^ (t >>> 15), 1 | t);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashContent(source: string): string {
  return createHash('sha256').update(source).digest('hex');
}

/**
 * Shaders get a lattice, sketches get a particle scatter. Distinguishable at
 * thumbnail size, which is the entire job — a grid of 20 identical badges
 * teaches you nothing about what you are looking at.
 */
export function generatePosterSvg(
  type: AssetType,
  slug: string,
  contentHash: string,
  size = 480,
): string {
  const rand = rng(contentHash);
  const body = type === 'p5' ? scatter(rand, size) : lattice(rand, size);

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">`,
    `<rect width="${size}" height="${size}" fill="${PALETTE.bg}"/>`,
    body,
    `<text x="16" y="${size - 16}" font-family="ui-monospace,monospace" font-size="13"`,
    ` fill="${PALETTE.dim}" letter-spacing="0.08em">${escapeXml(slug.toUpperCase())}</text>`,
    `</svg>`,
  ].join('');
}

function lattice(rand: () => number, size: number): string {
  const cells = 4 + Math.floor(rand() * 8);
  const step = size / cells;
  const parts: string[] = [];

  for (let y = 0; y < cells; y++) {
    for (let x = 0; x < cells; x++) {
      const r = rand();
      if (r < 0.35) continue;
      const inset = step * (0.08 + rand() * 0.18);
      const accent = r > 0.88;
      parts.push(
        `<rect x="${(x * step + inset).toFixed(1)}" y="${(y * step + inset).toFixed(1)}"` +
          ` width="${(step - inset * 2).toFixed(1)}" height="${(step - inset * 2).toFixed(1)}"` +
          ` fill="${accent ? PALETTE.accent : PALETTE.surface}"` +
          ` opacity="${accent ? 0.9 : (0.3 + r * 0.5).toFixed(2)}"/>`,
      );
    }
  }
  return parts.join('');
}

function scatter(rand: () => number, size: number): string {
  const n = 60 + Math.floor(rand() * 120);
  const cx = size / 2;
  const cy = size / 2;
  const spread = size * (0.18 + rand() * 0.22);
  const parts: string[] = [];

  for (let i = 0; i < n; i++) {
    // sqrt keeps the disc evenly filled rather than clustered at the centre
    const a = rand() * Math.PI * 2;
    const d = Math.sqrt(rand()) * spread * (1 + rand() * 1.4);
    const r = 1 + rand() * 3;
    const accent = rand() > 0.82;
    parts.push(
      `<circle cx="${(cx + Math.cos(a) * d).toFixed(1)}" cy="${(cy + Math.sin(a) * d).toFixed(1)}"` +
        ` r="${r.toFixed(1)}" fill="${accent ? PALETTE.accent : '#e8e8ea'}"` +
        ` opacity="${(0.15 + rand() * 0.55).toFixed(2)}"/>`,
    );
  }
  return parts.join('');
}

/**
 * Dominant colours for the poster, so hue filtering works in Phase 1 even
 * before real renders exist. For uploaded raster assets this is replaced by
 * sharp-based extraction in `ingest.ts`.
 */
export function posterColors(contentHash: string, type: AssetType): string[] {
  const rand = rng(contentHash);
  const base = type === 'p5' ? 190 : 200;
  const hue = (base + (rand() - 0.5) * 60 + 360) % 360;
  return [PALETTE.bg, hslHex(hue, 0.9, 0.5), PALETTE.surface];
}

function hslHex(h: number, s: number, l: number): string {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const c = l - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1)));
    return Math.round(255 * c)
      .toString(16)
      .padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

function escapeXml(s: string): string {
  return s.replace(/[<>&'"]/g, (c) =>
    c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '&' ? '&amp;' : c === "'" ? '&apos;' : '&quot;',
  );
}
