/**
 * Visual Mood Lab — effects/manifest.json validation.
 *
 * CAVEAT: verify-seed.ts itself wasn't among the uploaded files, only
 * seed/manifest.json and the seed sources — so this mirrors what the
 * implementation plan and seed/manifest.json's own shape imply about that
 * script's job (schema validity, reserved-uniform collisions) rather than
 * literally matching its code. Worth a quick diff against the real
 * verify-seed.ts once it's available, to fold in anything this misses.
 *
 * BUGFIX (post-Part-1 testing): checks public/effects/ now, not repo-root
 * effects/ — see lib/effects/registry.ts's top doc for the full story.
 * Dark Strobe toggled on with zero visible effect on the canvas because
 * the shader source lived somewhere the browser's fetch() could never
 * reach; this script's own path needed the same correction the registry
 * did, or it would have kept reporting a healthy manifest against a
 * layout that silently doesn't work at runtime.
 *
 * Checks, per effect definition:
 *   - `file` resolves to a real file under public/effects/shaders/
 *   - shader source declares `fxMain(vec2` (the required entry point)
 *   - shader source does NOT redeclare u_fxSource/u_fxMix/u_time/
 *     u_resolution, main(), or `out vec4 fragColor` — the wrapper in
 *     lib/gl/effects-compositor.ts owns all of these; a file that
 *     redeclares one either silently shadows the wrapper's version or
 *     fails to compile, and either way it means the effect wasn't
 *     authored against the fxMain contract
 *   - every declared Control.id is unique within that effect (no
 *     collision with the reserved `mix` id the registry adds automatically)
 *   - every declared Control.binding.name is unique within that effect,
 *     and does not collide with a reserved uniform name
 *   - every glslType-bearing binding matches a uniform declaration the
 *     shader source actually contains (or notes it as MISSING — a param
 *     with no matching uniform renders but does nothing, same failure
 *     mode the seed shader param<->get() cross-reference exists to catch)
 *
 * Run: npx tsx --env-file=.env.local scripts/verify-effects.ts
 * (matches the project's stated convention — see IMPLEMENTATION_PLAN.md's
 * key-learnings note that --env-file is required for every tsx invocation)
 *
 * Location: scripts/verify-effects.ts
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const RESERVED_EFFECT_UNIFORMS = new Set(['u_fxSource', 'u_fxMix', 'u_time', 'u_resolution']);
const RESERVED_PARAM_IDS = new Set(['mix']);

interface ManifestControl {
  id: string;
  binding?: { target: string; name?: string; glslType?: string };
}

interface ManifestEffect {
  id: string;
  title: string;
  file: string;
  params: ManifestControl[];
}

interface Manifest {
  version: number;
  effects: ManifestEffect[];
}

function main(): void {
  const root = process.cwd();
  const manifestPath = join(root, 'public', 'effects', 'manifest.json');
  const shadersDir = join(root, 'public', 'effects', 'shaders');

  if (!existsSync(manifestPath)) {
    fail(`public/effects/manifest.json not found at ${manifestPath}`);
    return;
  }

  const manifest: Manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
  const errors: string[] = [];
  const warnings: string[] = [];
  const seenIds = new Set<string>();

  for (const effect of manifest.effects) {
    if (seenIds.has(effect.id)) {
      errors.push(`[${effect.id}] duplicate effect id in manifest`);
    }
    seenIds.add(effect.id);

    const shaderPath = join(shadersDir, effect.file);
    if (!existsSync(shaderPath)) {
      errors.push(`[${effect.id}] shader file not found: public/effects/shaders/${effect.file}`);
      continue;
    }

    const source = readFileSync(shaderPath, 'utf-8');

    if (!/\bvec4\s+fxMain\s*\(\s*vec2/.test(source)) {
      errors.push(`[${effect.id}] missing required entry point: vec4 fxMain(vec2 uv)`);
    }
    if (/\bvoid\s+main\s*\(/.test(source)) {
      errors.push(`[${effect.id}] declares its own main() — the wrapper in effects-compositor.ts owns this`);
    }
    if (/out\s+vec4\s+fragColor/.test(source)) {
      errors.push(`[${effect.id}] declares its own \`out vec4 fragColor\` — the wrapper owns this`);
    }
    for (const reserved of RESERVED_EFFECT_UNIFORMS) {
      if (new RegExp(`\\buniform\\s+\\w+\\s+${reserved}\\b`).test(source)) {
        errors.push(`[${effect.id}] redeclares reserved uniform ${reserved} — supplied by the wrapper`);
      }
    }

    const paramIds = new Set<string>();
    const bindingNames = new Set<string>();

    for (const control of effect.params) {
      if (RESERVED_PARAM_IDS.has(control.id)) {
        errors.push(`[${effect.id}] param id "${control.id}" collides with the reserved base "mix" control`);
      }
      if (paramIds.has(control.id)) {
        errors.push(`[${effect.id}] duplicate param id: ${control.id}`);
      }
      paramIds.add(control.id);

      const name = control.binding?.name;
      if (!name) continue;

      if (RESERVED_EFFECT_UNIFORMS.has(name)) {
        errors.push(`[${effect.id}] param "${control.id}" binds to reserved uniform name ${name}`);
      }
      if (bindingNames.has(name)) {
        errors.push(`[${effect.id}] duplicate uniform binding: ${name}`);
      }
      bindingNames.add(name);

      const declared = new RegExp(`\\buniform\\s+\\w+\\s+${name}\\b`).test(source);
      if (!declared) {
        warnings.push(`[${effect.id}] param "${control.id}" binds to ${name}, no matching uniform declaration found in ${effect.file} — renders but does nothing`);
      }
    }
  }

  if (warnings.length) {
    console.warn(`\n${warnings.length} warning(s):`);
    for (const w of warnings) console.warn(`  ⚠ ${w}`);
  }

  if (errors.length) {
    console.error(`\n${errors.length} error(s):`);
    for (const e of errors) console.error(`  ✗ ${e}`);
    process.exitCode = 1;
    return;
  }

  console.log(`\n✓ public/effects/manifest.json valid — ${manifest.effects.length} effect(s) checked, 0 errors${warnings.length ? `, ${warnings.length} warning(s)` : ''}.`);
}

function fail(message: string): void {
  console.error(`✗ ${message}`);
  process.exitCode = 1;
}

main();
