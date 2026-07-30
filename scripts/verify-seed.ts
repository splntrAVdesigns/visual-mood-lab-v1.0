/**
 * Verifies every seed asset parses into a valid ControlSchema.
 *
 * This is the Phase 0 exit gate for the seed library, and it stays useful
 * forever: run it in CI and a malformed annotation or a typo'd control kind
 * fails the build instead of producing a silently empty inspector panel.
 *
 *   npm run verify:seed
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { parseUniforms } from '../lib/gl/parse-uniforms';
import { paramsToSchema } from '../lib/sketch/params-to-schema';
import {
  type Control,
  type ControlSchema,
  defaultsOf,
  groupedControls,
  isVisible,
} from '../renderers/control-schema';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SEED = join(ROOT, 'seed');

interface ManifestEntry {
  slug: string;
  type: 'shader' | 'p5';
  file: string;
  title: string;
  tags: string[];
}

const manifest = JSON.parse(readFileSync(join(SEED, 'manifest.json'), 'utf8')) as {
  version: number;
  assets: ManifestEntry[];
};

let failures = 0;
const kindsSeen = new Set<string>();

function fail(msg: string): void {
  failures++;
  console.error(`  FAIL  ${msg}`);
}

function ok(msg: string): void {
  console.log(`  ok    ${msg}`);
}

/**
 * Structural checks that apply to any schema regardless of source. If these
 * pass, the inspector can render it.
 */
function validate(schema: ControlSchema, label: string): void {
  const ids = new Set<string>();

  for (const c of schema.controls) {
    if (ids.has(c.id)) fail(`${label}: duplicate control id "${c.id}"`);
    ids.add(c.id);
    kindsSeen.add(c.kind);

    if (!c.label) fail(`${label}: control "${c.id}" has no label`);

    if (c.group && !schema.groups.some((g) => g.id === c.group)) {
      fail(`${label}: control "${c.id}" references undeclared group "${c.group}"`);
    }

    checkRange(c, label);
  }

  // Every declared default must survive a round trip through defaultsOf.
  const state = defaultsOf(schema);
  for (const c of schema.controls) {
    if (c.kind === 'trigger') continue;
    if (state[c.id] === undefined) fail(`${label}: "${c.id}" produced no default value`);
  }

  // showIf must reference a control that exists, or the row is unreachable.
  for (const c of schema.controls) {
    if (!c.showIf) continue;
    const refs = predicateRefs(c.showIf);
    for (const ref of refs) {
      if (!ids.has(ref)) fail(`${label}: "${c.id}" showIf references unknown control "${ref}"`);
    }
    isVisible(c, state); // must not throw
  }

  // Grouping must not silently drop controls.
  const grouped = groupedControls(schema).reduce((n, g) => n + g.controls.length, 0);
  if (grouped !== schema.controls.length) {
    fail(`${label}: grouping lost ${schema.controls.length - grouped} control(s)`);
  }
}

function checkRange(c: Control, label: string): void {
  if (c.kind === 'slider' || c.kind === 'stepper') {
    if (c.min >= c.max) fail(`${label}: "${c.id}" has min >= max`);
    if (c.default < c.min || c.default > c.max) {
      fail(`${label}: "${c.id}" default ${c.default} is outside ${c.min}..${c.max}`);
    }
  }
  if (c.kind === 'select') {
    if (!c.options.length) fail(`${label}: "${c.id}" has no options`);
    if (!c.options.some((o) => o.value === c.default)) {
      fail(`${label}: "${c.id}" default "${c.default}" is not among its options`);
    }
  }
}

function predicateRefs(p: unknown): string[] {
  if (!p || typeof p !== 'object') return [];
  const o = p as Record<string, unknown>;
  if (Array.isArray(o.all)) return o.all.flatMap(predicateRefs);
  if (Array.isArray(o.any)) return o.any.flatMap(predicateRefs);
  if (typeof o.truthy === 'string') return [o.truthy];
  if (Array.isArray(o.equals)) return [String(o.equals[0])];
  if (Array.isArray(o.notEquals)) return [String(o.notEquals[0])];
  return [];
}

async function main(): Promise<void> {
  /* ------------------------------------------------------------------ */

  console.log(`\nVerifying ${manifest.assets.length} seed asset(s)\n`);

  for (const entry of manifest.assets) {
    console.log(`${entry.slug}  [${entry.type}]`);
    const path = join(SEED, entry.file);

    if (entry.type === 'shader') {
      const source = readFileSync(path, 'utf8');
      const { schema, uniforms, warnings } = parseUniforms(source, {
        schemaId: `shader:${entry.slug}`,
      });

      if (!schema.controls.length) fail(`${entry.slug}: produced zero controls`);
      else ok(`${schema.controls.length} controls from ${uniforms.length} uniforms`);

      for (const w of warnings) {
        if (w.level === 'warn') fail(`${entry.slug}: ${w.message}`);
        else console.log(`  note  ${w.message}`);
      }

      validate(schema, entry.slug);
    } else {
      const mod = (await import(pathToFileURL(path).href)) as {
        params?: unknown;
        default?: unknown;
      };

      if (typeof mod.default !== 'function') {
        fail(`${entry.slug}: no default export sketch function`);
      }

      const { schema, warnings } = paramsToSchema(mod.params, {
        schemaId: `sketch:${entry.slug}`,
      });

      if (!schema.controls.length) fail(`${entry.slug}: produced zero controls`);
      else ok(`${schema.controls.length} controls`);

      for (const w of warnings) {
        if (w.level === 'warn') fail(`${entry.slug}: ${w.message}`);
        else console.log(`  note  ${w.message}`);
      }

      validate(schema, entry.slug);
    }

    console.log('');
  }

  console.log(`Control kinds exercised: ${[...kindsSeen].sort().join(', ')}`);

  if (failures > 0) {
    console.error(`\n${failures} failure(s).\n`);
    process.exit(1);
  }

  console.log('\nAll seed assets valid.\n');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
