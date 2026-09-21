/**
 * Phase 4.98 — floating sidecar panels: pure layout logic.
 *
 * No React, no DOM, no storage in this file. Everything here is a plain
 * function of its arguments so it can be verified under `tsx` alone
 * (scripts/verify-panel-layout.ts) and reused unchanged by the store, the
 * drag handler, and the resize clamp.
 *
 * Coordinate system: CSS pixels, viewport-relative, top-left origin —
 * the same space `position: fixed` uses, which is what a floating panel is.
 */

/** Stack order, top to bottom — matches the order the overlay renders them. */
export const PANEL_ORDER = ['sound', 'vfx', 'capture', 'mod'] as const;
export type PanelId = (typeof PANEL_ORDER)[number];
export type PanelMode = 'stack' | 'float';

export interface FloatGeometry {
  x: number;
  y: number;
  /** Width only — height is content-driven, capped by the space below. */
  w: number;
}

/**
 * The area a floating panel may occupy. `rightInset` is the width of the
 * fixed Inspector drawer on the right; a panel is never allowed under it.
 */
export interface Viewport {
  width: number;
  height: number;
  rightInset: number;
}

export const PANEL_MARGIN = 8;
/** Distance within which a dragged panel snaps to an edge. */
export const SNAP_DISTANCE = 12;
/** A floating panel's top stays at least this far above the bottom edge, so its header is always reachable. */
export const HANDLE_HEIGHT = 48;
/**
 * Stacked panels can be narrower than this on small windows
 * (min(20vw, 280px) at ≥821px wide), so detaching normalises up to it.
 */
export const MIN_PANEL_WIDTH = 240;
export const MAX_PANEL_WIDTH = 480;
export const DEFAULT_PANEL_WIDTH = 280;
/**
 * A panel detaches at LEAST this wide (its left edge stays put, the right
 * edge grows). A floating header carries two more buttons than a stacked one
 * (Move, Float/Dock), and at the stack's 280px Modulation's title truncated
 * to "Modulat…". Floating panels also have no neighbours to squeeze, so the
 * extra room is free.
 */
export const FLOAT_DEFAULT_WIDTH = 320;
/**
 * Extra leftward shift when a panel is floated with the button (not when it is
 * dragged out, where it already follows the pointer). Without it the panel
 * pops out exactly on top of where it was, and the stack reflowing up
 * underneath makes it look like nothing happened.
 */
export const FLOAT_BUTTON_OFFSET = 32;
/** Pointer travel before a header press becomes a drag. */
export const DRAG_THRESHOLD = 6;
export const KEY_STEP = 16;
export const KEY_STEP_LARGE = 64;

export const PANEL_LAYOUT_STORAGE_KEY = 'vml:panel-layout-v1';
export const PANEL_LAYOUT_VERSION = 1;

// Generous sanity bound for persisted coordinates. Anything beyond this is
// corrupt or hostile, not a real monitor — dropped rather than clamped so a
// garbage value can't silently become a plausible-looking edge position.
const MAX_SANE_COORDINATE = 20000;

const isFiniteNumber = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

/**
 * Force a geometry fully inside the viewport (left of the Inspector) with
 * its header reachable. Total: non-finite input falls back to the margin /
 * default width rather than propagating NaN into inline styles. When the
 * viewport is too small for the panel, the panel pins to the margin instead
 * of producing an inverted range.
 */
export function clampGeometry(geo: FloatGeometry, viewport: Viewport): FloatGeometry {
  const availW = viewport.width - viewport.rightInset - PANEL_MARGIN * 2;
  const rawW = isFiniteNumber(geo.w) ? geo.w : DEFAULT_PANEL_WIDTH;
  let w = clamp(rawW, MIN_PANEL_WIDTH, MAX_PANEL_WIDTH);
  if (availW >= MIN_PANEL_WIDTH) w = Math.min(w, availW);

  const minX = PANEL_MARGIN;
  const maxX = viewport.width - viewport.rightInset - w - PANEL_MARGIN;
  const minY = PANEL_MARGIN;
  const maxY = viewport.height - HANDLE_HEIGHT - PANEL_MARGIN;

  const x = maxX < minX ? minX : clamp(isFiniteNumber(geo.x) ? geo.x : minX, minX, maxX);
  const y = maxY < minY ? minY : clamp(isFiniteNumber(geo.y) ? geo.y : minY, minY, maxY);

  return { x: Math.round(x), y: Math.round(y), w: Math.round(w) };
}

/**
 * Snap a (already clamped) geometry to the left edge, top edge, the
 * Inspector boundary, and — when the panel's height is known — the bottom
 * edge. Each axis snaps independently.
 */
export function snapGeometry(
  geo: FloatGeometry,
  viewport: Viewport,
  opts: { height?: number } = {},
): FloatGeometry {
  let { x, y } = geo;
  const leftEdge = PANEL_MARGIN;
  const rightEdge = viewport.width - viewport.rightInset - geo.w - PANEL_MARGIN;
  const topEdge = PANEL_MARGIN;

  if (Math.abs(x - leftEdge) <= SNAP_DISTANCE) x = leftEdge;
  else if (rightEdge >= leftEdge && Math.abs(x - rightEdge) <= SNAP_DISTANCE) x = rightEdge;

  if (Math.abs(y - topEdge) <= SNAP_DISTANCE) y = topEdge;
  else if (isFiniteNumber(opts.height)) {
    const bottomY = viewport.height - PANEL_MARGIN - opts.height;
    if (bottomY >= topEdge && Math.abs(y - bottomY) <= SNAP_DISTANCE) y = bottomY;
  }

  return { x: Math.round(x), y: Math.round(y), w: geo.w };
}

/**
 * Where a panel lands when it detaches from the stack.
 *
 * The RIGHT edge stays where it was and the panel grows LEFTWARD to its
 * floating width, minus an optional extra shift. In the desktop layout the
 * stack sits to the left of the tile, so growing rightward (left edge fixed)
 * pushed the widened panel over the visual. Clamped like any other geometry,
 * so with no room on the left it degrades to growing rightward rather than
 * going off-screen.
 */
export function detachGeometry(
  rect: { left: number; top: number; width: number },
  viewport: Viewport,
  opts: { offset?: number } = {},
): FloatGeometry {
  const w = clamp(Math.max(rect.width, FLOAT_DEFAULT_WIDTH), MIN_PANEL_WIDTH, MAX_PANEL_WIDTH);
  const right = rect.left + rect.width;
  return clampGeometry({ x: right - w - (opts.offset ?? 0), y: rect.top, w }, viewport);
}

/** Keyboard move: shift by (dx, dy) and re-clamp. */
export function nudgeGeometry(
  geo: FloatGeometry,
  dx: number,
  dy: number,
  viewport: Viewport,
): FloatGeometry {
  return clampGeometry({ x: geo.x + dx, y: geo.y + dy, w: geo.w }, viewport);
}

/** Re-clamp every stored geometry; `changed` lets callers skip a no-op persist. */
export function clampAllGeometry(
  geometry: Partial<Record<PanelId, FloatGeometry>>,
  viewport: Viewport,
): { geometry: Partial<Record<PanelId, FloatGeometry>>; changed: boolean } {
  const next: Partial<Record<PanelId, FloatGeometry>> = {};
  let changed = false;
  for (const id of PANEL_ORDER) {
    const current = geometry[id];
    if (!current) continue;
    const clamped = clampGeometry(current, viewport);
    if (clamped.x !== current.x || clamped.y !== current.y || clamped.w !== current.w) changed = true;
    next[id] = clamped;
  }
  return { geometry: next, changed };
}

// ---------------------------------------------------------------------------
// Persistence shape
// ---------------------------------------------------------------------------

export interface PersistedPanelLayout {
  v: typeof PANEL_LAYOUT_VERSION;
  modes: Record<PanelId, PanelMode>;
  geometry: Partial<Record<PanelId, FloatGeometry>>;
}

export function defaultModes(): Record<PanelId, PanelMode> {
  return { sound: 'stack', vfx: 'stack', capture: 'stack', mod: 'stack' };
}

export function defaultPersistedLayout(): PersistedPanelLayout {
  return { v: PANEL_LAYOUT_VERSION, modes: defaultModes(), geometry: {} };
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const hasOwn = (obj: Record<string, unknown>, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(obj, key);

/**
 * Defensive parse of whatever came out of localStorage (already
 * JSON.parse'd). Never throws, never rejects legitimate data, and reads
 * ONLY whitelisted keys — nothing from the input object is spread or
 * copied wholesale, so `__proto__` / `constructor` keys in hostile JSON
 * have nowhere to land. Anything unusable falls back to defaults for that
 * field; a wrong version or non-object input falls back to all defaults.
 */
export function parsePersistedLayout(raw: unknown): PersistedPanelLayout {
  const result = defaultPersistedLayout();
  if (!isPlainObject(raw) || !hasOwn(raw, 'v') || raw.v !== PANEL_LAYOUT_VERSION) return result;

  if (hasOwn(raw, 'modes') && isPlainObject(raw.modes)) {
    for (const id of PANEL_ORDER) {
      if (hasOwn(raw.modes, id) && raw.modes[id] === 'float') result.modes[id] = 'float';
    }
  }

  if (hasOwn(raw, 'geometry') && isPlainObject(raw.geometry)) {
    for (const id of PANEL_ORDER) {
      if (!hasOwn(raw.geometry, id)) continue;
      const g = raw.geometry[id];
      if (!isPlainObject(g)) continue;
      const { x, y, w } = g;
      if (!isFiniteNumber(x) || !isFiniteNumber(y) || !isFiniteNumber(w)) continue;
      if (Math.abs(x) > MAX_SANE_COORDINATE || Math.abs(y) > MAX_SANE_COORDINATE) continue;
      result.geometry[id] = {
        x: Math.round(x),
        y: Math.round(y),
        w: Math.round(clamp(w, MIN_PANEL_WIDTH, MAX_PANEL_WIDTH)),
      };
    }
  }

  // A panel persisted as floating with no usable geometry has nowhere to
  // be — put it back in the stack rather than inventing a position.
  for (const id of PANEL_ORDER) {
    if (result.modes[id] === 'float' && !result.geometry[id]) result.modes[id] = 'stack';
  }

  return result;
}

// ---------------------------------------------------------------------------
// Accordion (stack mode)
// ---------------------------------------------------------------------------

export type CollapsedMap = Record<PanelId, boolean>;

export function allExpanded(): CollapsedMap {
  return { sound: false, vfx: false, capture: false, mod: false };
}

/**
 * Expand `id`. In stack mode, and unless `additive`, every OTHER stacked
 * panel collapses. Floating panels are exempt in both directions: a
 * floating `id` never collapses anything, and floating panels are never
 * collapsed by someone else's expansion.
 */
export function afterExpand(
  collapsed: CollapsedMap,
  modes: Record<PanelId, PanelMode>,
  id: PanelId,
  additive = false,
): CollapsedMap {
  const next = { ...collapsed, [id]: false };
  if (additive || modes[id] !== 'stack') return next;
  for (const other of PANEL_ORDER) {
    if (other !== id && modes[other] === 'stack') next[other] = true;
  }
  return next;
}

/** Opening a panel is expanding it, non-additively. */
export function afterOpen(
  collapsed: CollapsedMap,
  modes: Record<PanelId, PanelMode>,
  id: PanelId,
): CollapsedMap {
  return afterExpand(collapsed, modes, id, false);
}

/**
 * Chevron press: collapsed → expand (with accordion side effects);
 * expanded → collapse (no side effects).
 */
export function afterToggle(
  collapsed: CollapsedMap,
  modes: Record<PanelId, PanelMode>,
  id: PanelId,
  additive = false,
): CollapsedMap {
  if (collapsed[id]) return afterExpand(collapsed, modes, id, additive);
  return { ...collapsed, [id]: true };
}

/**
 * After every panel has been docked, keep only the front-most one
 * expanded. `zOrder` is back → front; the last entry wins.
 */
export function afterDockAll(collapsed: CollapsedMap, zOrder: readonly PanelId[]): CollapsedMap {
  const front = zOrder.length > 0 ? zOrder[zOrder.length - 1] : undefined;
  const next = { ...collapsed };
  for (const id of PANEL_ORDER) next[id] = front !== undefined && id !== front;
  return next;
}

/** Move `id` to the front of a back → front z-order. */
export function raiseInOrder(zOrder: readonly PanelId[], id: PanelId): PanelId[] {
  if (zOrder[zOrder.length - 1] === id) return zOrder.slice();
  return [...zOrder.filter((p) => p !== id), id];
}
