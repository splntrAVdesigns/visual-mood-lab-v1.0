// scripts/verify-capture.ts
//
// Video export — frame-size contract (fix/mobile-mp4).
//
// Proves, against the INSTALLED Mediabunny rather than by reading its source:
//   1. canEncodeVideo('avc') refuses any odd width/height even when the
//      browser encoder would accept it — the exact path that produced
//      "No supported MP4 encoder found on this device." on iOS;
//   2. encodableSize() always hands it an even size, never grows the frame,
//      and trims at most one pixel per axis;
//   3. real tile-canvas sizes (ShaderRenderer's round(css × min(dpr, 2) × fit)
//      formula over phone-width layouts) are odd often enough that this was
//      bound to surface on mobile, and all of them encode once normalised.
//
// Run: npx tsx scripts/verify-capture.ts
// Location: scripts/verify-capture.ts

import { canEncodeVideo } from 'mediabunny';
import { encodableSize } from '../lib/capture/support';

let failures = 0;
function check(name: string, ok: boolean, detail?: unknown): void {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}`);
  if (!ok) {
    failures++;
    if (detail !== undefined) console.log('        ', detail);
  }
}

// A stand-in browser encoder that accepts every config, so any `false` below
// can only come from Mediabunny's own pre-checks.
const g = globalThis as unknown as { VideoEncoder?: unknown };
g.VideoEncoder = class {
  static async isConfigSupported(config: unknown) { return { supported: true, config }; }
};

async function main(): Promise<void> {
  console.log('\nMediabunny AVC frame-size rule');
  check('even 780×770 encodes', await canEncodeVideo('avc', { width: 780, height: 770 }));
  check('odd width 781×770 refused', !(await canEncodeVideo('avc', { width: 781, height: 770 })));
  check('odd height 780×771 refused', !(await canEncodeVideo('avc', { width: 780, height: 771 })));
  check('VP9 does not care (781×771 encodes)', await canEncodeVideo('vp9', { width: 781, height: 771 }));

  console.log('\nencodableSize()');
  let allEven = true, neverGrows = true, trimsAtMostOne = true;
  for (let w = 1; w <= 1400; w++) {
    const h = 1401 - w;
    const s = encodableSize(w, h);
    if (s.width % 2 || s.height % 2) allEven = false;
    if (w >= 2 && h >= 2 && (s.width > w || s.height > h)) neverGrows = false;
    if (w >= 2 && h >= 2 && (w - s.width > 1 || h - s.height > 1)) trimsAtMostOne = false;
  }
  check('always even', allEven);
  check('never larger than the tile canvas (≥ 2 px)', neverGrows);
  check('trims at most 1 px per axis', trimsAtMostOne);
  check('even input passes through unchanged', JSON.stringify(encodableSize(1280, 720)) === '{"width":1280,"height":720}');
  check('floors to the 2 px minimum', JSON.stringify(encodableSize(1, 1)) === '{"width":2,"height":2}');

  console.log('\nPhone-layout tile sizes (ShaderRenderer sizing formula)');
  const STAGE_MAX = 1280;
  let odd = 0, total = 0, allEncode = true;
  for (const cssW of [375, 390, 393, 402, 414, 428, 430, 440]) {
    // Focused-view height moves in quarter-px steps as the iOS URL bar and
    // panel layout settle; sweep a realistic band of it.
    for (let cssH = 300; cssH <= 460; cssH += 0.25) {
      const rawW = Math.max(1, Math.round(cssW * 2));
      const rawH = Math.max(1, Math.round(cssH * 2));
      const fit = Math.min(1, STAGE_MAX / Math.max(rawW, rawH));
      const w = Math.max(1, Math.round(rawW * fit));
      const h = Math.max(1, Math.round(rawH * fit));
      total++;
      if (w % 2 || h % 2) odd++;
      const s = encodableSize(w, h);
      if (!(await canEncodeVideo('avc', { width: s.width, height: s.height }))) allEncode = false;
    }
  }
  console.log(`        ${odd}/${total} raw tile sizes are odd (${((odd / total) * 100).toFixed(0)}%) — each of these failed MP4 before the fix`);
  check('odd tile sizes occur in real phone layouts (the regression is reachable)', odd > 0);
  check('every one of them encodes as AVC once normalised', allEncode);

  console.log(failures ? `\n${failures} check(s) failed.\n` : '\nAll capture checks passed.\n');
  process.exit(failures ? 1 : 0);
}

void main();
