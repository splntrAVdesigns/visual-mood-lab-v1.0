/**
 * Visual Mood Lab — Control Schema
 * ---------------------------------
 * Every renderer (image, svg, video, p5, shader) declares its parameters as a
 * ControlSchema. The inspector drawer renders itself from that declaration —
 * no per-asset-type UI code, ever.
 *
 * Adding a new asset type = one adapter file + a schema. Zero UI changes.
 *
 * Location: renderers/control-schema.ts
 */

// Type-only: erased at compile time, so this does not create a runtime
// circular dependency even though types/asset.ts imports back from here.
import type { AssetType } from '@/types/asset';

/* ------------------------------------------------------------------ *
 * Primitives
 * ------------------------------------------------------------------ */

export type Vec2 = [number, number];
export type Vec3 = [number, number, number];
export type RGBA = { r: number; g: number; b: number; a: number };

export type ParamValue = number | boolean | string | Vec2 | Vec3 | RGBA | null;

/** Flat map of controlId -> current value. This is what gets persisted. */
export type ParamState = Record<string, ParamValue>;

export type GlslType =
  | 'float' | 'int' | 'uint' | 'bool'
  | 'vec2' | 'vec3' | 'vec4'
  | 'ivec2' | 'ivec3' | 'ivec4'
  | 'uvec2' | 'uvec3' | 'uvec4'
  | 'bvec2' | 'bvec3' | 'bvec4'
  | 'mat2' | 'mat3' | 'mat4'
  | 'mat2x3' | 'mat2x4' | 'mat3x2' | 'mat3x4' | 'mat4x2' | 'mat4x3'
  | 'sampler2D' | 'sampler3D' | 'samplerCube' | 'sampler2DArray';

/* ------------------------------------------------------------------ *
 * Modulation — the global param bus
 * ------------------------------------------------------------------ */

/**
 * Any control marked `modulatable` can be driven by a shared signal source.
 * This is what makes every asset on the board audio-reactive for free, and
 * what MIDI learn hooks into later.
 */
export type ModSource =
  | 'time'
  | 'audio.rms' | 'audio.bass' | 'audio.mid' | 'audio.high'
  | 'mic.rms' | 'mic.bass' | 'mic.mid' | 'mic.high'
  | 'lfo.sine' | 'lfo.triangle' | 'lfo.saw' | 'lfo.noise'
  | 'pointer.x' | 'pointer.y'
  | 'midi.cc';

export interface Modulation {
  source: ModSource;
  /** -1..1. Scaled against the control's own range at apply time. */
  amount: number;
  /** Hz. Only meaningful for lfo.* sources. */
  rate?: number;
  /** Only meaningful for midi.cc. */
  cc?: number;
  /** Smoothing coefficient, 0 = none, 0.9 = heavy. */
  smoothing?: number;
}

/** controlId -> modulation. Stored alongside ParamState. */
export type ModState = Record<string, Modulation>;

/* ------------------------------------------------------------------ *
 * Sound — the tile-instrument bus (audio-out, mirrors Modulation above)
 * ------------------------------------------------------------------ */

export type MusicalScale = 'major' | 'minor' | 'pentatonic' | 'chromatic';

/** Reuses the exact option set Static Choir's Waveform Shape select already
    established, so a user who's touched one understands the other. */
export type LfoShape = 'sine' | 'triangle' | 'square' | 'sawtooth';

/**
 * Per-card sound configuration — the audio-out counterpart to ModState.
 * Where Modulation samples a SOURCE to drive a visual control, a sound
 * preset samples a visual control's own live value to drive an audio
 * parameter instead. The preset engine and its vocabulary (SoundPreset,
 * SoundBinding, the arp/pad/pluck/retro-oneshot/abstract engines) live in
 * lib/sound/ — mirroring how ModSource/MOD_SOURCES live in
 * lib/modulation/bus.ts rather than here. This is just the persisted
 * shape, stored alongside ParamState and ModState.
 */
export interface SoundState {
  enabled: boolean;
  presetId: string | null;
  /**
   * Selected root notes, 1-3 of them, e.g. ['C', 'E']. Always at least
   * one — the note rack refuses to deselect the last remaining entry, so
   * there is always a root.
   *
   * What more than one MEANS is the engine's business, deliberately, and
   * differs between them:
   *   - pad (Acid Melt): a genuine chord — one voice pair per note,
   *     sounding simultaneously. Sample-backed pads are the exception and
   *     use notes[0] only; see PadEngine's comment for why.
   *   - arp (Field Lines): the pool plucks draw from — every selected
   *     note contributes its own scale's degrees, merged and sorted, so
   *     two notes genuinely widens the available pitch set rather than
   *     one overriding the other.
   *
   * Replaced the old `key: string` when the Key dropdown became the note
   * rack. Rows persisted before that change still carry `key` and no
   * `notes` — normalizeSoundState() in lib/sound/types.ts migrates them
   * on read, which is why nothing here needs a DB migration (sound is a
   * JSONB column) and why no code should read a raw persisted sound
   * object without passing it through that function first.
   */
  notes: string[];
  scale: MusicalScale;
  /** -2..2 */
  octave: number;
  /** Only meaningful for presets with an LFO-modulated target (a tremolo
      pad, for instance) — ignored otherwise. Kept on SoundState rather
      than baked into the preset because this is the one thing the
      redesigned Acid Melt experience is explicitly meant to let a user
      adjust. */
  lfoShape: LfoShape;
  /** 0..1 */
  volume: number;
  /**
   * Arp engine only (see ArpEngine in lib/sound/engines/arp.ts) — adds a
   * few cents of random detune, a little velocity variance, and (for a
   * scheduled-mode preset) a little timing wobble to each note, so a
   * sequence or a run of plucks doesn't sound machine-quantized. No
   * effect on a pad preset; the Sound panel disables this toggle when the
   * active preset's engine isn't 'arp'.
   */
  humanize: boolean;
  /**
   * Arp engine, scheduled-mode presets only — delays every other
   * scheduled note slightly for a swung rhythmic feel. Meaningless for a
   * graze-to-pluck (triggerMode: 'event') preset, which has no fixed grid
   * to swing against; the Sound panel disables this toggle for those
   * rather than leaving a control that visibly does nothing.
   */
  swing: boolean;
}

/* ------------------------------------------------------------------ *
 * Conditional visibility
 * ------------------------------------------------------------------ */

export type ControlPredicate =
  | { equals: [controlId: string, value: ParamValue] }
  | { notEquals: [controlId: string, value: ParamValue] }
  | { truthy: string }
  | { all: ControlPredicate[] }
  | { any: ControlPredicate[] };

/* ------------------------------------------------------------------ *
 * Bindings — where a control's value actually lands
 * ------------------------------------------------------------------ */

export type Binding =
  /** GLSL uniform on the active program. */
  | { target: 'uniform'; name: string; glslType: GlslType; arrayLength?: number }
  /** Property on the sandboxed p5 sketch, delivered via postMessage. */
  | { target: 'sketch'; path: string }
  /** DOM/CSS property on the host element (opacity, filter, transform). */
  | { target: 'element'; property: string }
  /** Host-level concern handled by the renderer base class (playback, blend). */
  | { target: 'host'; property: string };

/* ------------------------------------------------------------------ *
 * Controls
 * ------------------------------------------------------------------ */

export type ControlKind =
  | 'slider' | 'stepper' | 'toggle' | 'color' | 'select'
  | 'xy' | 'vec3' | 'text' | 'trigger' | 'texture';

interface ControlCommon {
  /** Unique within a schema. Also the key in ParamState. */
  id: string;
  label: string;
  /** Group id. Falls back to the schema's first group. */
  group?: string;
  /** One-line help text shown on hover / long-press. */
  hint?: string;
  /** Sort order within the group. Lower first. Ties break on declaration order. */
  order?: number;
  /** Hidden behind the "Advanced" disclosure in the drawer. */
  advanced?: boolean;
  /**
   * Shown but inert — greyed out, its interactive control disabled, with
   * `disabledLabel` (defaults to "Future feature") rendered as a badge
   * next to the field label. For a control that exists in the schema
   * (and therefore in saved params, for forward-compat) but has no real
   * implementation behind it yet — e.g. Blend mode, ahead of Phase 5.5's
   * actual multi-layer compositing pipeline. Distinct from removing the
   * control entirely: the person can see it's coming rather than
   * wondering if it silently vanished.
   */
  disabled?: boolean;
  /** Badge text when `disabled` is true. Defaults to "Future feature". */
  disabledLabel?: string;
  /**
   * Shown, and visible, but greyed out and inert whenever this predicate
   * passes against current ParamState — the conditional counterpart to
   * `disabled` above. `disabled` is a fixed schema-authoring-time flag
   * ("this doesn't exist yet"); `disabledIf` is for a control that's
   * perfectly real but doesn't apply to whatever the sibling control it
   * depends on is currently set to — e.g. a global "layers" control that
   * a specific render style ignores entirely. Distinct from `showIf`:
   * hiding a control that still has a meaningful (if unused) saved value
   * reads as "did my setting get lost", where greying it out with its
   * current value still visible doesn't.
   */
  disabledIf?: ControlPredicate;
  /** Eligible for the modulation bus (audio / LFO / MIDI). */
  modulatable?: boolean;
  /** Only shown when this predicate passes against current ParamState. */
  showIf?: ControlPredicate;
  binding?: Binding;
}

export interface SliderControl extends ControlCommon {
  kind: 'slider';
  default: number;
  min: number;
  max: number;
  step?: number;
  /** 'log' for frequency/density-style params where linear feels wrong. */
  scale?: 'linear' | 'log';
  unit?: string;
  /** Decimal places shown in the numeric readout. */
  precision?: number;
}

export interface StepperControl extends ControlCommon {
  kind: 'stepper';
  default: number;
  min: number;
  max: number;
  step?: number;
}

export interface ToggleControl extends ControlCommon {
  kind: 'toggle';
  default: boolean;
}

export interface ColorControl extends ControlCommon {
  kind: 'color';
  default: RGBA;
  /** Show the alpha slider. */
  alpha?: boolean;
}

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectControl extends ControlCommon {
  kind: 'select';
  default: string;
  options: SelectOption[];
  /**
   * When 'number', the renderer parses option values with Number() before
   * writing them to the binding. Lets an int uniform expose named modes.
   */
  valueType?: 'string' | 'number';
  /** 'strip' renders a compact button row instead of a dropdown — see
      the @strip annotation in lib/gl/parse-uniforms.ts. Undefined/
      'dropdown' keeps the existing Select behavior untouched. */
  displayStyle?: 'dropdown' | 'strip';
}

export interface XYControl extends ControlCommon {
  kind: 'xy';
  default: Vec2;
  min: Vec2;
  max: Vec2;
  step?: number;
  /** Draw the pad square and lock aspect. Good for centre/offset params. */
  lockAspect?: boolean;
}

export interface Vec3Control extends ControlCommon {
  kind: 'vec3';
  default: Vec3;
  min: Vec3;
  max: Vec3;
  step?: number;
  /** Axis labels. Defaults to X / Y / Z. */
  axisLabels?: [string, string, string];
}

export interface TextControl extends ControlCommon {
  kind: 'text';
  default: string;
  multiline?: boolean;
  maxLength?: number;
  monospace?: boolean;
}

/** Fire-and-forget action. Has no persisted value. */
export interface TriggerControl extends ControlCommon {
  kind: 'trigger';
  default: null;
  /** Event name dispatched to the renderer, e.g. 'reseed' | 'clear'. */
  event: string;
  /** Renders in the destructive style. */
  danger?: boolean;
}

/** Picks another library asset (or an upload) to feed a sampler. */
export interface TextureControl extends ControlCommon {
  kind: 'texture';
  /** Asset id, or null for none. */
  default: string | null;
  accept?: Array<'image' | 'video' | 'svg'>;
  /** Offer the board's own render output as a source (feedback loops). */
  allowSelf?: boolean;
}

/**
 * Picks an embedded font for a text-rendering asset (e.g. type-grid).
 *
 * Deliberately as thin as TextureControl above, for the same reason: the
 * schema carries only a font id (`default`) plus an optional category
 * filter, not the actual list of fonts. The list itself lives once, in
 * `lib/fonts/manifest.ts` (backed by `public/fonts/manifest.json`), and
 * FontControlRow resolves against it directly — adding a font to the
 * library never touches this file.
 */
export interface FontControl extends ControlCommon {
  kind: 'font';
  /** Font id from lib/fonts/manifest.ts, e.g. 'rajdhani'. */
  default: string;
  /** Restrict the picker to one category. Omit (or 'any') to show every
      embedded font regardless of category. */
  category?: 'sans' | 'mono' | 'display' | 'serif' | 'any';
}

export type Control =
  | SliderControl | StepperControl | ToggleControl | ColorControl
  | SelectControl | XYControl | Vec3Control | TextControl
  | TriggerControl | TextureControl | FontControl;

/* ------------------------------------------------------------------ *
 * Schema
 * ------------------------------------------------------------------ */

export interface ControlGroup {
  id: string;
  label: string;
  order?: number;
  /** Start collapsed in the drawer. */
  collapsed?: boolean;
}

export interface ControlSchema {
  /** Usually the renderer id, or `shader:${assetId}`. */
  id: string;
  /** Bump when a schema changes shape so persisted params can be migrated. */
  version: number;
  groups: ControlGroup[];
  controls: Control[];
}

/* ------------------------------------------------------------------ *
 * Shared base schema — every asset gets these
 * ------------------------------------------------------------------ */

export const BLEND_MODES: SelectOption[] = [
  { value: 'normal', label: 'Normal' },
  { value: 'multiply', label: 'Multiply' },
  { value: 'screen', label: 'Screen' },
  { value: 'overlay', label: 'Overlay' },
  { value: 'difference', label: 'Difference' },
  { value: 'exclusion', label: 'Exclusion' },
  { value: 'color-dodge', label: 'Color dodge' },
  { value: 'luminosity', label: 'Luminosity' },
];

export const BASE_GROUPS: ControlGroup[] = [
  { id: 'playback', label: 'Playback', order: 0 },
  { id: 'appearance', label: 'Appearance', order: 10 },
  { id: 'transform', label: 'Transform', order: 20, collapsed: true },
  { id: 'params', label: 'Parameters', order: 30 },
];

/**
 * Controls shared by every renderer. Merge these under a renderer's own
 * controls so the drawer always opens with a familiar top section.
 */
export const BASE_CONTROLS: Control[] = [
  {
    id: 'paused', kind: 'toggle', label: 'Paused', group: 'playback',
    default: false, order: 0, binding: { target: 'host', property: 'paused' },
  },
  {
    id: 'speed', kind: 'slider', label: 'Speed', group: 'playback',
    default: 1, min: 0, max: 4, step: 0.01, order: 1, unit: '×',
    modulatable: true, binding: { target: 'host', property: 'speed' },
  },
  {
    id: 'loop', kind: 'toggle', label: 'Loop', group: 'playback',
    default: true, order: 2, binding: { target: 'host', property: 'loop' },
  },
  {
    id: 'opacity', kind: 'slider', label: 'Opacity', group: 'appearance',
    default: 1, min: 0, max: 1, step: 0.01, order: 0,
    modulatable: true, binding: { target: 'element', property: 'opacity' },
  },
  {
    // Disabled ahead of Phase 5.5 (Blend & Mask Mode): CSS mix-blend-mode
    // needs a second real layer to composite against, and today a media
    // tile is the only thing painted on the black board stage — most
    // modes (multiply, overlay, color-dodge, luminosity) mathematically
    // resolve to solid black against that backdrop, and the rest render
    // indistinguishably from Normal. Left in the schema (not removed) so
    // the control reappears with working behavior the moment real layer
    // compositing exists, rather than needing to be re-added. Tint below
    // is the working substitute in the meantime.
    id: 'blendMode', kind: 'select', label: 'Blend mode', group: 'appearance',
    default: 'normal', options: BLEND_MODES, order: 1,
    binding: { target: 'element', property: 'mixBlendMode' },
    disabled: true, disabledLabel: 'Future feature',
  },
  {
    // Unlike Blend mode above, this genuinely works today: the color
    // swatch is its own layer blended directly against the image/video
    // beneath it — real content, not the black board stage — so the
    // blend actually has something to composite against.
    id: 'tint', kind: 'color', label: 'Tint', group: 'appearance',
    default: { r: 1, g: 1, b: 1, a: 1 }, order: 2, alpha: false,
    binding: { target: 'element', property: 'tint' },
  },
  {
    id: 'tintAmount', kind: 'slider', label: 'Tint amount', group: 'appearance',
    default: 0, min: 0, max: 1, step: 0.01, order: 3,
    modulatable: true, binding: { target: 'element', property: 'tintAmount' },
  },
  {
    id: 'scale', kind: 'slider', label: 'Scale', group: 'transform',
    default: 1, min: 0.1, max: 4, step: 0.01, order: 0, scale: 'log',
    modulatable: true, binding: { target: 'element', property: 'scale' },
  },
  {
    id: 'offset', kind: 'xy', label: 'Offset', group: 'transform',
    default: [0, 0], min: [-1, -1], max: [1, 1], step: 0.001,
    order: 1, lockAspect: true, modulatable: true,
    binding: { target: 'element', property: 'translate' },
  },
  {
    id: 'rotation', kind: 'slider', label: 'Rotation', group: 'transform',
    default: 0, min: -180, max: 180, step: 0.5, order: 2, unit: '°',
    modulatable: true, binding: { target: 'element', property: 'rotate' },
  },
];

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

export function createSchema(
  id: string,
  controls: Control[],
  opts: { version?: number; groups?: ControlGroup[] } = {},
): ControlSchema {
  return {
    id,
    version: opts.version ?? 1,
    groups: opts.groups ?? BASE_GROUPS,
    controls,
  };
}

/**
 * Merge schemas left to right. Later controls with the same id win, which is
 * how a renderer overrides a base control (e.g. a still image dropping
 * 'speed' by replacing it, or narrowing 'scale' to a smaller range).
 */
export function mergeSchemas(...schemas: ControlSchema[]): ControlSchema {
  const controls = new Map<string, Control>();
  const groups = new Map<string, ControlGroup>();
  let version = 1;
  let id = '';

  for (const schema of schemas) {
    id = schema.id || id;
    version = Math.max(version, schema.version);
    for (const g of schema.groups) groups.set(g.id, { ...groups.get(g.id), ...g });
    for (const c of schema.controls) controls.set(c.id, c);
  }

  return {
    id,
    version,
    groups: [...groups.values()].sort(byOrder),
    controls: [...controls.values()],
  };
}

/** Convenience: base controls + a renderer's own, in one call. */
export function withBaseControls(
  id: string,
  controls: Control[],
  opts: { version?: number; groups?: ControlGroup[]; omit?: string[] } = {},
): ControlSchema {
  const omit = new Set(opts.omit ?? []);
  const base = createSchema(id, BASE_CONTROLS.filter((c) => !omit.has(c.id)), opts);
  return mergeSchemas(base, createSchema(id, controls, opts));
}

/**
 * The fallback schema for an asset that has none cached (image, svg, video —
 * shader and p5 assets always have a real one from ingest).
 *
 * Exists so there is exactly one place that decides "images don't get
 * Speed/Loop/Paused." It used to be decided twice — once correctly inside
 * MediaRenderer, and once, forgotten, inside the code path that actually
 * builds what the inspector panel shows — and the two disagreed. A shared
 * function can't drift from itself.
 */
export function defaultSchemaFor(id: string, type: AssetType): ControlSchema {
  const isMedia = type === 'image' || type === 'svg' || type === 'video';

  return withBaseControls(id, [], {
    omit: type === 'video' ? [] : ['speed', 'loop', 'paused'],
    // Transform (scale, rotation, offset) is usually the first thing worth
    // touching on a static image or video — unlike a shader's Composition
    // group, which is more of a power-user corner. Media types get it open.
    groups: isMedia
      ? BASE_GROUPS.map((g) => (g.id === 'transform' ? { ...g, collapsed: false } : g))
      : undefined,
  });
}

/** Initial ParamState for a schema. Triggers are excluded — they hold no value. */
export function defaultsOf(schema: ControlSchema): ParamState {
  const state: ParamState = {};
  for (const c of schema.controls) {
    if (c.kind === 'trigger') continue;
    state[c.id] = cloneValue(c.default);
  }
  return state;
}

/**
 * Merge persisted params over schema defaults, dropping keys the schema no
 * longer declares. Call this on load — it is the migration path when a shader
 * gains or loses a uniform.
 */
export function hydrate(schema: ControlSchema, saved: ParamState | undefined): ParamState {
  const state = defaultsOf(schema);
  if (!saved) return state;
  for (const c of schema.controls) {
    if (c.kind === 'trigger') continue;
    if (saved[c.id] !== undefined) state[c.id] = coerce(c, saved[c.id]);
  }
  return state;
}

/** Clamp / validate an incoming value against its control. Never throws. */
export function coerce(control: Control, value: ParamValue): ParamValue {
  switch (control.kind) {
    case 'slider':
    case 'stepper': {
      const n = typeof value === 'number' ? value : Number(value);
      if (!Number.isFinite(n)) return control.default;
      const clamped = clamp(n, control.min, control.max);
      return control.kind === 'stepper' ? Math.round(clamped) : clamped;
    }
    case 'toggle':
      return typeof value === 'boolean' ? value : Boolean(value);
    case 'select': {
      const v = String(value);
      return control.options.some((o) => o.value === v) ? v : control.default;
    }
    case 'color':
      return isRGBA(value)
        ? {
            r: clamp(value.r, 0, 1), g: clamp(value.g, 0, 1),
            b: clamp(value.b, 0, 1), a: clamp(value.a, 0, 1),
          }
        : control.default;
    case 'xy': {
      if (!isVecN(value, 2)) return control.default;
      const v = value as number[];
      return [
        clamp(v[0], control.min[0], control.max[0]),
        clamp(v[1], control.min[1], control.max[1]),
      ] as Vec2;
    }
    case 'vec3': {
      if (!isVecN(value, 3)) return control.default;
      const v = value as number[];
      return [
        clamp(v[0], control.min[0], control.max[0]),
        clamp(v[1], control.min[1], control.max[1]),
        clamp(v[2], control.min[2], control.max[2]),
      ] as Vec3;
    }
    case 'text': {
      const s = typeof value === 'string' ? value : String(value ?? '');
      return control.maxLength ? s.slice(0, control.maxLength) : s;
    }
    case 'texture':
      return typeof value === 'string' || value === null ? value : control.default;
    case 'font':
      // Deliberately not checked against lib/fonts/manifest.ts here — this
      // module has no import of that registry (and shouldn't grow one just
      // for this), so an id that's since been removed from the manifest
      // falls through as a plain string rather than being caught at
      // coerce()-time. FontControlRow and any sketch reading get('font')
      // already resolve a missing id safely (getFontEntry() returning
      // undefined, falling back to DEFAULT_FONT_ID) — this just guards the
      // shape of the stored value, the same way 'texture' above only
      // checks "string or null," not "asset actually exists."
      return typeof value === 'string' ? value : control.default;
    case 'trigger':
      return null;
  }
}

/** Evaluate a control's showIf predicate against current state. */
export function isVisible(control: Control, state: ParamState): boolean {
  return control.showIf ? evalPredicate(control.showIf, state) : true;
}

/** Evaluate a control's disabledIf predicate against current state —
    the conditional counterpart to isVisible above, see disabledIf's own
    doc on ControlCommon for why this is a separate flag rather than
    reusing showIf inverted. */
export function isDisabledByState(control: Control, state: ParamState): boolean {
  return control.disabledIf ? evalPredicate(control.disabledIf, state) : false;
}

export function evalPredicate(p: ControlPredicate, state: ParamState): boolean {
  if ('all' in p) return p.all.every((q) => evalPredicate(q, state));
  if ('any' in p) return p.any.some((q) => evalPredicate(q, state));
  if ('truthy' in p) return Boolean(state[p.truthy]);
  if ('equals' in p) return shallowEq(state[p.equals[0]], p.equals[1]);
  return !shallowEq(state[p.notEquals[0]], p.notEquals[1]);
}

/** Group controls in render order. This is what the drawer maps over. */
export function groupedControls(
  schema: ControlSchema,
): Array<{ group: ControlGroup; controls: Control[] }> {
  const fallback = schema.groups[0]?.id ?? 'params';
  const buckets = new Map<string, Control[]>();

  schema.controls.forEach((c, i) => {
    const key = c.group ?? fallback;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push({ ...c, order: c.order ?? i } as Control);
  });

  return schema.groups
    .filter((g) => buckets.has(g.id))
    .sort(byOrder)
    .map((group) => ({
      group,
      controls: buckets.get(group.id)!.sort(byOrder),
    }));
}

/**
 * Apply a modulation signal on top of a base value, scaled to the control's
 * own range. `signal` is expected in 0..1 from the param bus.
 */
export function applyModulation(
  control: Control,
  base: ParamValue,
  mod: Modulation,
  signal: number,
): ParamValue {
  if (control.kind !== 'slider' && control.kind !== 'stepper') return base;
  if (typeof base !== 'number') return base;
  const span = control.max - control.min;
  const next = base + (signal - 0.5) * 2 * mod.amount * span;
  return coerce(control, next);
}

/* ------------------------------------------------------------------ *
 * Internals
 * ------------------------------------------------------------------ */

function byOrder(a: { order?: number }, b: { order?: number }): number {
  return (a.order ?? 0) - (b.order ?? 0);
}

function clamp(n: number, min: number, max: number): number {
  return n < min ? min : n > max ? max : n;
}

function isRGBA(v: unknown): v is RGBA {
  return typeof v === 'object' && v !== null && 'r' in v && 'g' in v && 'b' in v;
}

function isVecN(v: unknown, n: number): v is number[] {
  return Array.isArray(v) && v.length === n && v.every((x) => typeof x === 'number');
}

function cloneValue(v: ParamValue): ParamValue {
  if (Array.isArray(v)) return [...v] as Vec2 | Vec3;
  if (isRGBA(v)) return { ...v };
  return v;
}

function shallowEq(a: ParamValue, b: ParamValue): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((x, i) => x === b[i]);
  }
  if (isRGBA(a) && isRGBA(b)) return a.r === b.r && a.g === b.g && a.b === b.b && a.a === b.a;
  return a === b;
}
