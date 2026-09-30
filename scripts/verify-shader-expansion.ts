/** Focused, database-free checks for the four geometric shader tiles.
 * Run: node --import tsx scripts/verify-shader-expansion.ts */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseUniforms } from '../lib/gl/parse-uniforms';
import { defaultsOf, groupedControls, isVisible, withBaseControls, applyModulation } from '../renderers/control-schema';
import { dominantTone } from '../lib/sound/tone-analysis';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(resolve(root, 'seed/manifest.json'), 'utf8'));
const expected: Record<string, string> = {
  'spatial-hud': 'Spatial HUD', 'symmetry-shapes': 'Symmetry Shapes',
  'folded-fields': 'Folded Fields', 'nodal-matter': 'Nodal Matter',
};
assert.equal(new Set(manifest.assets.map((a: { slug: string }) => a.slug)).size, manifest.assets.length);
const hud = manifest.assets.find((a: { slug: string }) => a.slug === 'hud-array');
assert.equal(hud.type, 'p5');
assert.equal(hud.file, 'sketches/hud-array.js');
for (const [slug, title] of Object.entries(expected)) {
  const entry = manifest.assets.find((a: { slug: string }) => a.slug === slug);
  assert(entry, `${slug}: missing registration`);
  assert.equal(entry.title, title);
  assert.equal(entry.type, 'shader');
  const source = readFileSync(resolve(root, 'seed', entry.file), 'utf8');
  assert(source.startsWith('#version 300 es'));
  const parsed = parseUniforms(source, { schemaId: `shader:${slug}` });
  assert.deepEqual(parsed.warnings.filter(w => w.level === 'warn'), [], `${slug}: schema warnings`);
  const schema = withBaseControls(parsed.schema.id, parsed.schema.controls, { groups: parsed.schema.groups });
  const state = defaultsOf(schema);
  assert.equal(new Set(schema.controls.map(c => c.id)).size, schema.controls.length);
  assert.equal(groupedControls(schema).reduce((n, g) => n + g.controls.length, 0), schema.controls.length);
  for (const id of ['speed', 'paused', 'opacity', 'scale', 'rotation', 'offset']) {
    assert(schema.controls.some(c => c.id === id), `${slug}: missing host ${id}`);
  }
  assert.equal(schema.controls.filter(c => c.kind === 'color' && c.binding?.target === 'uniform').length, 4);
  for (const c of schema.controls) {
    isVisible(c, state);
    if (c.kind === 'slider' && c.modulatable) {
      const next = applyModulation(c, c.default, { source: 'audio.bass', amount: 1 }, 1);
      assert.equal(typeof next, 'number');
      assert((next as number) >= c.min && (next as number) <= c.max);
    }
  }
  if (slug === 'symmetry-shapes') {
    const pattern = schema.controls.find(c => c.id === 'u_pattern');
    assert(pattern?.kind === 'select' && pattern.options.some(o => o.label === 'Random'));
  }
  if (slug === 'nodal-matter') assert(!schema.controls.some(c => c.id === 'u_trackTone'));
  console.log(`PASS ${title}: registration, defaults, groups, colors, shared controls and modulation bounds`);
}
for (const sampleRate of [44100, 48000, 96000]) {
  for (const frequency of [110, 440, 1000, 3000, 5800]) {
    const bins = new Float32Array(2048).fill(-100);
    const center = frequency / (sampleRate / 4096);
    for (let i = 0; i < bins.length; i++) bins[i] = -20 - 8 * (i - center) ** 2;
    const tone = dominantTone(bins, sampleRate, 4096);
    assert(tone && Math.abs(tone.frequency - frequency) < 0.1, `${frequency} Hz @ ${sampleRate}`);
    assert(tone.energy > 0 && tone.energy <= 1);
  }
}
assert.equal(dominantTone(new Float32Array(2048).fill(-Infinity), 48000, 4096), null);
assert.equal(dominantTone(new Float32Array(2048).fill(-100), 48000, 4096), null);
assert.equal(dominantTone(new Float32Array(2048).fill(NaN), 48000, 4096), null);
console.log('PASS dominant tone: 15 reference spectra across three sample rates; silence and invalid bins');
