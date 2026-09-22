/**
 * Shape Source — font loading for text shapes.
 *
 * Text is rasterised on a 2D canvas in the HOST document, which (unlike the
 * sandboxed p5 iframe) has no @font-face rules for the embedded library
 * fonts. Drawing before the face has loaded silently uses a fallback font,
 * so every face is registered through the FontFace API and awaited first.
 *
 * Uses the same registry every other text tile uses (lib/fonts/manifest.ts),
 * so the Shapeshift font picker offers exactly the curated set.
 *
 * Registered under a private family name (`VMLShape-<id>`) so it can never
 * collide with, or restyle, anything the page itself declares.
 *
 * Location: lib/shape-source/fonts.ts
 */

import { DEFAULT_FONT_ID, getFontEntry } from '@/lib/fonts/manifest';

export interface LoadedFont {
  family: string;
  /** Heaviest weight the face supports — Shapeshift wants poster-weight type. */
  weight: number;
}

const loaded = new Map<string, Promise<LoadedFont>>();

function heaviest(weight: string): number {
  const parts = weight.trim().split(/\s+/).map(Number).filter(Number.isFinite);
  return parts.length ? Math.max(...parts) : 400;
}

export function loadShapeFont(fontId: string): Promise<LoadedFont> {
  const entry = getFontEntry(fontId) ?? getFontEntry(DEFAULT_FONT_ID);
  if (!entry) return Promise.resolve({ family: 'sans-serif', weight: 900 });

  const hit = loaded.get(entry.id);
  if (hit) return hit;

  const family = `VMLShape-${entry.id}`;
  // Prefer an upright face, then the heaviest one.
  const files = [...entry.files].sort(
    (a, b) => (a.style === 'normal' ? 0 : 1) - (b.style === 'normal' ? 0 : 1) || heaviest(b.weight) - heaviest(a.weight),
  );
  const file = files[0];

  const promise = (async (): Promise<LoadedFont> => {
    const weight = heaviest(file.weight);
    try {
      const face = new FontFace(family, `url(${file.url})`, { weight: file.weight, style: file.style });
      await face.load();
      document.fonts.add(face);
      return { family, weight };
    } catch {
      loaded.delete(entry.id); // allow a retry next time
      return { family: 'sans-serif', weight: 900 };
    }
  })();

  loaded.set(entry.id, promise);
  return promise;
}
