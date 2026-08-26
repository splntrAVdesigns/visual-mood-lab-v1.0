/**
 * Font registry — single source of truth for every embeddable font.
 *
 * The JSON itself lives at `public/fonts/manifest.json`, not here, on
 * purpose: it needs to be readable from TWO separate JS contexts that
 * don't share a module graph — this Next.js app (which imports it, for
 * the inspector's font picker) and the sandboxed sketch iframe (which
 * `fetch()`s it directly at runtime, same-origin, to resolve a font id
 * into a URL it can hand to `p.loadFont()`). Duplicating the data as a
 * second TS-only registry would let the two silently drift; importing
 * the one JSON file from both sides can't.
 *
 * This also means adding a font to the library is always a two-part
 * drop: the actual font file(s) under `public/fonts/{custom,google}/`,
 * plus one new entry in manifest.json. Nothing else needs to change —
 * this file, the inspector's FontControl, and any sketch that reads
 * `get('font')` all resolve against the same registry automatically.
 */

import manifestJson from '../../public/fonts/manifest.json';

export type FontSource = 'custom' | 'google';
export type FontCategory = 'sans' | 'mono' | 'display' | 'serif';

export interface FontFile {
  /** Public, same-origin path — fetchable both from the host app and
      from inside the sandboxed iframe. */
  url: string;
  /** CSS font-weight value. A variable font gives its full supported
      range as "min max" (e.g. "100 900"), matching the `font-weight`
      syntax `@font-face` already expects for variable fonts. */
  weight: string;
  style: 'normal' | 'italic';
}

export interface FontEntry {
  id: string;
  /** Display name shown in the picker. */
  family: string;
  /** The literal `font-family` value to apply — kept separate from
      `family` because a few of the custom faces need a distinct
      internal family name from their display label. */
  cssFamily: string;
  source: FontSource;
  category: FontCategory;
  files: FontFile[];
  /** Shown as a small flag in the picker for anything that isn't a
      normal full release — e.g. universa-demo, a demo/trial build. */
  note?: string;
}

interface FontManifestJson {
  version: number;
  fonts: FontEntry[];
}

const manifest = manifestJson as FontManifestJson;

export const FONT_MANIFEST: FontEntry[] = manifest.fonts;

export function getFontEntry(id: string): FontEntry | undefined {
  return FONT_MANIFEST.find((f) => f.id === id);
}

export function fontsByCategory(category: FontCategory | 'any'): FontEntry[] {
  if (category === 'any') return FONT_MANIFEST;
  return FONT_MANIFEST.filter((f) => f.category === category);
}

/** The id every `font` control falls back to if a saved param references
    a font that no longer exists in the manifest (removed/renamed). */
export const DEFAULT_FONT_ID = 'rajdhani';
