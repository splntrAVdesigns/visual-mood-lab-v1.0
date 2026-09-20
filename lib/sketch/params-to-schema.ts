/**
 * Visual Mood Lab — sketch params → ControlSchema
 * -----------------------------------------------
 * The p5 counterpart to `parseUniforms`. A sketch exports a plain `params`
 * object; this validates it and produces the same ControlSchema the shader
 * path produces, so the inspector cannot tell the two apart.
 *
 * Deliberately not a parser. The sketch's params object is real JavaScript,
 * so there is nothing to lex — this only has to validate shape and fill in
 * defaults. That asymmetry with the GLSL path is the whole point of choosing
 * an object over a comment DSL.
 *
 * Location: lib/sketch/params-to-schema.ts
 */

import { sanitizeSchema } from '@/lib/schema/sanitize';
import {
  type Control,
  type ControlGroup,
  type ControlSchema,
  BASE_GROUPS,
  createSchema,
} from '@/renderers/control-schema';

export interface SketchParseWarning {
  level: 'warn' | 'info';
  message: string;
  id?: string;
}

export interface SketchParseResult {
  schema: ControlSchema;
  warnings: SketchParseWarning[];
}

const VALID_KINDS = new Set([
  'slider', 'stepper', 'toggle', 'color', 'select',
  'xy', 'vec3', 'text', 'trigger', 'texture', 'font',
]);

/** Fields every kind needs beyond the common set. */
const REQUIRED: Record<string, string[]> = {
  slider: ['min', 'max', 'default'],
  stepper: ['min', 'max', 'default'],
  toggle: ['default'],
  color: ['default'],
  select: ['options', 'default'],
  xy: ['min', 'max', 'default'],
  vec3: ['min', 'max', 'default'],
  text: ['default'],
  trigger: ['event'],
  texture: [],
  font: ['default'],
};

export function paramsToSchema(
  raw: unknown,
  opts: { schemaId?: string; defaultGroup?: string } = {},
): SketchParseResult {
  const warnings: SketchParseWarning[] = [];
  const controls: Control[] = [];
  const extraGroups = new Map<string, ControlGroup>();
  const defaultGroup = opts.defaultGroup ?? 'params';

  if (!raw || typeof raw !== 'object') {
    warnings.push({ level: 'warn', message: 'Sketch exports no `params` object — base controls only.' });
    return { schema: createSchema(opts.schemaId ?? 'sketch', []), warnings };
  }

  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!value || typeof value !== 'object') {
      warnings.push({ level: 'warn', id, message: `"${id}" is not a control descriptor.` });
      continue;
    }

    const desc = value as Record<string, unknown>;
    const kind = desc.kind;

    if (typeof kind !== 'string' || !VALID_KINDS.has(kind)) {
      warnings.push({ level: 'warn', id, message: `"${id}" has unknown kind "${String(kind)}".` });
      continue;
    }

    const missing = (REQUIRED[kind] ?? []).filter((k) => desc[k] === undefined);
    if (missing.length) {
      warnings.push({
        level: 'warn', id,
        message: `"${id}" (${kind}) is missing: ${missing.join(', ')}.`,
      });
      continue;
    }

    const group = typeof desc.group === 'string' ? desc.group : defaultGroup;
    if (!BASE_GROUPS.some((g) => g.id === group) && !extraGroups.has(group)) {
      extraGroups.set(group, {
        id: group,
        label: titleCase(group),
        order: 40 + extraGroups.size,
      });
    }

    controls.push({
      ...(desc as object),
      id,
      kind,
      group,
      label: typeof desc.label === 'string' ? desc.label : titleCase(id),
      binding: desc.binding ?? { target: 'sketch', path: id },
    } as Control);
  }

  if (!controls.length) {
    warnings.push({ level: 'info', message: 'No valid controls found in `params`.' });
  }

  // `{ ...desc }` above copies EVERYTHING the author wrote into the control —
  // NaN, Infinity, reversed ranges, an invalid color, a `roll` hint. Repair it
  // here, once, so nothing downstream ever sees it. A well-formed `params`
  // comes back untouched — see lib/schema/sanitize.ts.
  const clean = sanitizeSchema(
    createSchema(opts.schemaId ?? 'sketch', controls, { groups: [...BASE_GROUPS, ...extraGroups.values()] }),
  );
  for (const w of clean.warnings) {
    warnings.push({ level: 'warn', message: w.message, id: w.id.startsWith('(') ? undefined : w.id });
  }

  return { schema: clean.schema, warnings };
}

function titleCase(s: string): string {
  const spaced = s
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
}
