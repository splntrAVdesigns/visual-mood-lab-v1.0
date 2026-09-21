/**
 * Floating-sidecar-panel layout verifier (Phase 4.98).
 *
 * Run with: npm run verify:panel-layout
 *
 * Covers lib/panels/layout.ts — the pure logic behind the panel store, the
 * drag handler, and the resize clamp. Same two directions as the tile-state
 * verifier, and the first matters more:
 *
 *   1. LEGITIMATE LAYOUTS MUST NEVER BE REJECTED. A persisted layout that a
 *      person built by dragging panels around must survive a reload
 *      unchanged. Persistence failures are silent, so an over-strict parser
 *      is worse than none.
 *   2. Hostile / corrupt data is refused without throwing: wrong types,
 *      non-finite or absurd numbers, unknown ids, prototype-pollution keys.
 *
 * Plus the invariants the UI leans on: a clamped panel is always fully on
 * screen with a reachable header and never under the Inspector; snapping is
 * per-axis and thresholded; the accordion collapses only stacked panels and
 * never touches floating ones.
 */

import {
  DEFAULT_PANEL_WIDTH,
  FLOAT_BUTTON_OFFSET,
  FLOAT_DEFAULT_WIDTH,
  HANDLE_HEIGHT,
  MAX_PANEL_WIDTH,
  MIN_PANEL_WIDTH,
  PANEL_MARGIN,
  PANEL_ORDER,
  SNAP_DISTANCE,
  afterDockAll,
  afterExpand,
  afterOpen,
  afterToggle,
  allExpanded,
  clampAllGeometry,
  clampGeometry,
  defaultModes,
  detachGeometry,
  defaultPersistedLayout,
  nudgeGeometry,
  parsePersistedLayout,
  raiseInOrder,
  snapGeometry,
  type CollapsedMap,
  type FloatGeometry,
  type PanelId,
  type PanelMode,
  type Viewport,
} from '../lib/panels/layout';

let passed = 0;
let failed = 0;
function check(name: string, condition: boolean, detail?: unknown): void {
  if (condition) passed++;
  else {
    failed++;
    console.error(`  FAIL  ${name}${detail !== undefined ? `  -> ${JSON.stringify(detail)}` : ''}`);
  }
}
function group(title: string): void {
  console.log(`\n${title}`);
}
/** JSON.parse so hostile keys like __proto__ arrive as OWN properties, exactly as from real storage. */
const J = (text: string): unknown => JSON.parse(text);

const VP: Viewport = { width: 1440, height: 900, rightInset: 320 };

function modesWith(floating: PanelId[]): Record<PanelId, PanelMode> {
  const m = defaultModes();
  for (const id of floating) m[id] = 'float';
  return m;
}
function collapsedWith(collapsed: PanelId[]): CollapsedMap {
  const c = allExpanded();
  for (const id of collapsed) c[id] = true;
  return c;
}
const eq = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

function verifyClamp(): void {
  group('clampGeometry');

  const inside: FloatGeometry = { x: 100, y: 120, w: 300 };
  check('in-bounds geometry is unchanged', eq(clampGeometry(inside, VP), inside));

  const farRight = clampGeometry({ x: 5000, y: 100, w: 300 }, VP);
  check('past the right edge → stops left of the Inspector', farRight.x + farRight.w <= VP.width - VP.rightInset - PANEL_MARGIN, farRight);
  check('past the right edge → exactly at the boundary', farRight.x === VP.width - VP.rightInset - 300 - PANEL_MARGIN, farRight);

  const negative = clampGeometry({ x: -400, y: -400, w: 300 }, VP);
  check('negative x/y → pinned to the margin', negative.x === PANEL_MARGIN && negative.y === PANEL_MARGIN, negative);

  const low = clampGeometry({ x: 100, y: 5000, w: 300 }, VP);
  check('past the bottom → header stays reachable', low.y === VP.height - HANDLE_HEIGHT - PANEL_MARGIN, low);

  check('width below minimum is raised', clampGeometry({ x: 50, y: 50, w: 10 }, VP).w === MIN_PANEL_WIDTH);
  check('width above maximum is lowered', clampGeometry({ x: 50, y: 50, w: 9000 }, VP).w === MAX_PANEL_WIDTH);

  const nan = clampGeometry({ x: NaN, y: Infinity, w: NaN }, VP);
  check('NaN / Infinity never propagate', Number.isFinite(nan.x) && Number.isFinite(nan.y) && Number.isFinite(nan.w), nan);
  check('NaN width falls back to the default', nan.w === DEFAULT_PANEL_WIDTH, nan);

  const tiny: Viewport = { width: 500, height: 300, rightInset: 320 };
  const cramped = clampGeometry({ x: 300, y: 200, w: 300 }, tiny);
  check('viewport smaller than the panel pins to the margin, no inverted range', cramped.x === PANEL_MARGIN, cramped);
  check('cramped result is still finite', Number.isFinite(cramped.x) && Number.isFinite(cramped.y) && Number.isFinite(cramped.w), cramped);

  const short: Viewport = { width: 1440, height: 40, rightInset: 320 };
  check('very short viewport pins y to the margin', clampGeometry({ x: 100, y: 500, w: 300 }, short).y === PANEL_MARGIN);

  const narrowAvail: Viewport = { width: 900, height: 700, rightInset: 320 };
  const narrow = clampGeometry({ x: 8, y: 8, w: 480 }, narrowAvail);
  check('wide panel is narrowed to fit beside the Inspector', narrow.x + narrow.w <= narrowAvail.width - narrowAvail.rightInset - PANEL_MARGIN, narrow);

  const idempotent = clampGeometry(clampGeometry({ x: 9999, y: -50, w: 700 }, VP), VP);
  check('clamp is idempotent', eq(idempotent, clampGeometry(idempotent, VP)), idempotent);

  // Invariant sweep: any input lands fully on screen, left of the Inspector.
  let sweepOk = true;
  for (const x of [-1e6, -1, 0, 8, 500, 1112, 1e6]) {
    for (const y of [-1e6, -1, 0, 8, 400, 852, 1e6]) {
      for (const w of [-50, 0, 240, 300, 480, 9999]) {
        const g = clampGeometry({ x, y, w }, VP);
        const ok =
          g.x >= PANEL_MARGIN &&
          g.y >= PANEL_MARGIN &&
          g.x + g.w <= VP.width - VP.rightInset - PANEL_MARGIN &&
          g.y <= VP.height - HANDLE_HEIGHT - PANEL_MARGIN &&
          g.w >= MIN_PANEL_WIDTH &&
          g.w <= MAX_PANEL_WIDTH;
        if (!ok) sweepOk = false;
      }
    }
  }
  check('sweep: every input clamps fully on screen, left of the Inspector', sweepOk);

  check('the floating default width is within the allowed range', FLOAT_DEFAULT_WIDTH >= MIN_PANEL_WIDTH && FLOAT_DEFAULT_WIDTH <= MAX_PANEL_WIDTH);
  check('the floating default width survives clamping on a normal window', clampGeometry({ x: 100, y: 100, w: FLOAT_DEFAULT_WIDTH }, VP).w === FLOAT_DEFAULT_WIDTH);
  const nudged = nudgeGeometry({ x: 100, y: 100, w: 300 }, 16, -16, VP);
  check('nudge moves by the step', nudged.x === 116 && nudged.y === 84, nudged);
  check('nudge re-clamps at the edge', nudgeGeometry({ x: PANEL_MARGIN, y: PANEL_MARGIN, w: 300 }, -64, -64, VP).x === PANEL_MARGIN);
}

function verifyDetach(): void {
  group('detachGeometry (float anchors by the right edge, grows away from the tile)');
  const WIDE: Viewport = { width: 2000, height: 1000, rightInset: 320 };
  const stacked = { left: 465, top: 340, width: 280 };
  const right = stacked.left + stacked.width;

  const drag = detachGeometry(stacked, WIDE);
  check('widens to the floating default', drag.w === FLOAT_DEFAULT_WIDTH, drag);
  check('right edge stays where it was (no growth toward the tile)', drag.x + drag.w === right, drag);
  check('top is preserved', drag.y === stacked.top, drag);

  const button = detachGeometry(stacked, WIDE, { offset: FLOAT_BUTTON_OFFSET });
  check('button path shifts left by the offset', button.x === drag.x - FLOAT_BUTTON_OFFSET, { button, drag });
  check('button path never overlaps the original right edge', button.x + button.w === right - FLOAT_BUTTON_OFFSET, button);

  const cramped = detachGeometry({ left: 20, top: 100, width: 280 }, WIDE, { offset: FLOAT_BUTTON_OFFSET });
  check('no room on the left → pinned to the margin, still on screen', cramped.x === PANEL_MARGIN && cramped.x >= 0, cramped);

  const wide = detachGeometry({ left: 300, top: 100, width: 400 }, WIDE);
  check('an already-wide panel keeps its width and left edge', wide.w === 400 && wide.x === 300, wide);
  check('width is capped at the maximum', detachGeometry({ left: 100, top: 100, width: 9000 }, WIDE).w === MAX_PANEL_WIDTH);

  const low = detachGeometry({ left: 465, top: 99999, width: 280 }, WIDE);
  check('top is clamped like any geometry (header stays reachable)', low.y === WIDE.height - HANDLE_HEIGHT - PANEL_MARGIN, low);

  let ok = true;
  for (const left of [-500, 0, 20, 465, 1500, 9999]) for (const top of [-50, 0, 340, 5000]) for (const width of [0, 100, 280, 320, 900]) {
    for (const offset of [0, FLOAT_BUTTON_OFFSET]) {
      const g = detachGeometry({ left, top, width }, WIDE, { offset });
      if (!(Number.isFinite(g.x) && Number.isFinite(g.y) && g.x >= PANEL_MARGIN && g.x + g.w <= WIDE.width - WIDE.rightInset - PANEL_MARGIN && g.w >= MIN_PANEL_WIDTH && g.w <= MAX_PANEL_WIDTH)) ok = false;
    }
  }
  check('sweep: every detach lands on screen, left of the Inspector, finite', ok);
}

function verifySnap(): void {
  group('snapGeometry');
  const rightEdge = (w: number) => VP.width - VP.rightInset - w - PANEL_MARGIN;

  check('near the left edge → snaps', snapGeometry({ x: PANEL_MARGIN + SNAP_DISTANCE, y: 300, w: 300 }, VP).x === PANEL_MARGIN);
  check('just outside the threshold → does not snap', snapGeometry({ x: PANEL_MARGIN + SNAP_DISTANCE + 1, y: 300, w: 300 }, VP).x === PANEL_MARGIN + SNAP_DISTANCE + 1);
  check('near the Inspector boundary → snaps', snapGeometry({ x: rightEdge(300) - 5, y: 300, w: 300 }, VP).x === rightEdge(300));
  check('near the top edge → snaps', snapGeometry({ x: 300, y: PANEL_MARGIN + 4, w: 300 }, VP).y === PANEL_MARGIN);
  check('axes snap independently', eq(snapGeometry({ x: PANEL_MARGIN + 3, y: 400, w: 300 }, VP), { x: PANEL_MARGIN, y: 400, w: 300 }));
  check('mid-screen is left alone', eq(snapGeometry({ x: 500, y: 400, w: 300 }, VP), { x: 500, y: 400, w: 300 }));

  const bottomY = VP.height - PANEL_MARGIN - 400;
  check('bottom edge snaps only when height is known', snapGeometry({ x: 300, y: bottomY - 6, w: 300 }, VP).y === bottomY - 6);
  check('bottom edge snaps with a known height', snapGeometry({ x: 300, y: bottomY - 6, w: 300 }, VP, { height: 400 }).y === bottomY);
  check('snap preserves width', snapGeometry({ x: 9, y: 9, w: 333 }, VP).w === 333);
}

function verifyClampAll(): void {
  group('clampAllGeometry');
  const ok = { sound: { x: 100, y: 100, w: 300 }, mod: { x: 400, y: 200, w: 320 } };
  const unchanged = clampAllGeometry(ok, VP);
  check('in-bounds set reports no change', unchanged.changed === false && eq(unchanged.geometry, ok), unchanged);

  const stale = clampAllGeometry({ vfx: { x: 2000, y: 50, w: 300 } }, VP);
  check('off-screen panel is pulled back and reported changed', stale.changed === true && (stale.geometry.vfx?.x ?? 0) < 2000, stale);

  const shrunk = clampAllGeometry({ sound: { x: 1000, y: 100, w: 300 } }, { width: 800, height: 600, rightInset: 320 });
  check('shrinking the window keeps every panel reachable', (shrunk.geometry.sound?.x ?? 9999) + (shrunk.geometry.sound?.w ?? 0) <= 800 - 320 - PANEL_MARGIN || (shrunk.geometry.sound?.x ?? 0) === PANEL_MARGIN, shrunk);
  check('empty geometry is fine', clampAllGeometry({}, VP).changed === false);
}

function verifyParseLegit(): void {
  group('parsePersistedLayout — legitimate data is never rejected');

  const d = parsePersistedLayout(undefined);
  check('undefined → defaults', eq(d, defaultPersistedLayout()));

  const layout = {
    v: 1,
    modes: { sound: 'float', vfx: 'stack', capture: 'float', mod: 'stack' },
    geometry: { sound: { x: 24, y: 96, w: 300 }, capture: { x: 600, y: 120, w: 260 } },
  };
  const parsed = parsePersistedLayout(J(JSON.stringify(layout)));
  check('a real layout round-trips exactly', eq(parsed, layout), parsed);

  const partial = parsePersistedLayout(J('{"v":1,"modes":{"mod":"float"},"geometry":{"mod":{"x":10,"y":10,"w":280}}}'));
  check('partial layouts fill the rest with defaults', partial.modes.mod === 'float' && partial.modes.sound === 'stack' && partial.geometry.mod?.x === 10, partial);

  // Every combination of modes with valid geometry must survive.
  let allOk = true;
  for (let mask = 0; mask < 1 << PANEL_ORDER.length; mask++) {
    const modes: Record<string, string> = {};
    const geometry: Record<string, FloatGeometry> = {};
    PANEL_ORDER.forEach((id, i) => {
      const floating = (mask >> i) & 1;
      modes[id] = floating ? 'float' : 'stack';
      geometry[id] = { x: 20 + i * 40, y: 60 + i * 30, w: 280 };
    });
    const out = parsePersistedLayout(J(JSON.stringify({ v: 1, modes, geometry })));
    if (!PANEL_ORDER.every((id) => out.modes[id] === modes[id])) allOk = false;
  }
  check('all 16 stack/float combinations survive', allOk);

  const fractional = parsePersistedLayout(J('{"v":1,"modes":{"sound":"float"},"geometry":{"sound":{"x":10.6,"y":20.4,"w":300.2}}}'));
  check('fractional coordinates are rounded, not rejected', eq(fractional.geometry.sound, { x: 11, y: 20, w: 300 }), fractional);
}

function verifyParseHostile(): void {
  group('parsePersistedLayout — hostile / corrupt data is refused without throwing');
  const defaults = defaultPersistedLayout();

  for (const [name, raw] of [
    ['null', null],
    ['a string', 'float'],
    ['a number', 42],
    ['an array', []],
    ['an array of layouts', [{ v: 1 }]],
    ['boolean', true],
  ] as const) {
    check(`${name} → defaults`, eq(parsePersistedLayout(raw), defaults));
  }

  check('missing version → defaults', eq(parsePersistedLayout(J('{"modes":{"sound":"float"},"geometry":{"sound":{"x":1,"y":1,"w":300}}}')), defaults));
  check('wrong version → defaults', eq(parsePersistedLayout(J('{"v":2,"modes":{"sound":"float"}}')), defaults));
  check('string version → defaults', eq(parsePersistedLayout(J('{"v":"1"}')), defaults));

  const unknownId = parsePersistedLayout(J('{"v":1,"modes":{"code":"float","nope":"float"},"geometry":{"code":{"x":1,"y":1,"w":300}}}'));
  check('unknown panel ids are ignored', eq(unknownId, defaults), unknownId);

  const badMode = parsePersistedLayout(J('{"v":1,"modes":{"sound":"FLOAT","vfx":1,"capture":null,"mod":{}}}'));
  check('non-"float" modes fall back to stack', PANEL_ORDER.every((id) => badMode.modes[id] === 'stack'), badMode);

  const badGeo = parsePersistedLayout(J('{"v":1,"modes":{"sound":"float","vfx":"float","capture":"float","mod":"float"},"geometry":{"sound":{"x":"10","y":10,"w":300},"vfx":{"x":1e999,"y":10,"w":300},"capture":{"x":10,"y":null,"w":300},"mod":[1,2,3]}}'));
  check('bad-typed / non-finite geometry is dropped', PANEL_ORDER.every((id) => badGeo.geometry[id] === undefined), badGeo);
  check('a panel with no usable geometry goes back to the stack', PANEL_ORDER.every((id) => badGeo.modes[id] === 'stack'), badGeo);

  const huge = parsePersistedLayout(J('{"v":1,"modes":{"sound":"float"},"geometry":{"sound":{"x":9999999,"y":10,"w":300}}}'));
  check('absurd coordinates are dropped, not clamped to a plausible edge', huge.geometry.sound === undefined && huge.modes.sound === 'stack', huge);

  const widthClamp = parsePersistedLayout(J('{"v":1,"modes":{"sound":"float","vfx":"float"},"geometry":{"sound":{"x":10,"y":10,"w":9},"vfx":{"x":10,"y":10,"w":99999}}}'));
  check('out-of-range width is clamped into range', widthClamp.geometry.sound?.w === MIN_PANEL_WIDTH && widthClamp.geometry.vfx?.w === MAX_PANEL_WIDTH, widthClamp);

  // Prototype-pollution shapes arrive as OWN properties via JSON.parse.
  const proto = parsePersistedLayout(J('{"v":1,"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}},"modes":{"__proto__":{"sound":"float"}},"geometry":{"__proto__":{"sound":{"x":1,"y":1,"w":300}}}}'));
  check('__proto__ / constructor keys are ignored', eq(proto, defaults), proto);
  check('nothing leaked onto Object.prototype', ({} as Record<string, unknown>).polluted === undefined);
  check('result has no inherited surprises', Object.getPrototypeOf(proto.modes) === Object.prototype);

  let threw = false;
  try {
    for (const junk of [undefined, null, NaN, Symbol.iterator, () => 1, { v: 1, modes: null, geometry: null }, { v: 1, modes: 'x', geometry: 'y' }]) {
      parsePersistedLayout(junk);
    }
  } catch {
    threw = true;
  }
  check('never throws, whatever it is given', !threw);
}

function verifyAccordion(): void {
  group('accordion');

  const stack = defaultModes();
  const expandMod = afterExpand(allExpanded(), stack, 'mod');
  check('expanding one stacked panel collapses the other stacked panels', eq(expandMod, { sound: true, vfx: true, capture: true, mod: false }), expandMod);

  const additive = afterExpand(collapsedWith(['sound', 'vfx']), stack, 'vfx', true);
  check('additive expand does not collapse others', eq(additive, { sound: true, vfx: false, capture: false, mod: false }), additive);

  const mixed = modesWith(['vfx']);
  const expandSound = afterExpand(allExpanded(), mixed, 'sound');
  check('a floating panel is never collapsed by a stacked panel expanding', expandSound.vfx === false, expandSound);
  check('the stacked others still collapse', expandSound.capture === true && expandSound.mod === true, expandSound);

  const expandFloat = afterExpand(collapsedWith(['sound', 'mod']), mixed, 'vfx');
  check('expanding a floating panel collapses nothing', expandFloat.sound === true && expandFloat.mod === true && expandFloat.capture === false && expandFloat.vfx === false, expandFloat);

  const collapseOnly = afterToggle(allExpanded(), stack, 'sound');
  check('collapsing has no side effects', eq(collapseOnly, { sound: true, vfx: false, capture: false, mod: false }), collapseOnly);
  const toggleExpand = afterToggle(collapsedWith(['sound', 'vfx', 'capture']), stack, 'sound');
  check('toggling a collapsed panel expands it with accordion effects', eq(toggleExpand, { sound: false, vfx: true, capture: true, mod: true }), toggleExpand);
  const toggleAdditive = afterToggle(collapsedWith(['sound', 'vfx']), stack, 'sound', true);
  check('toggle with additive expands without collapsing', eq(toggleAdditive, { sound: false, vfx: true, capture: false, mod: false }), toggleAdditive);

  const opened = afterOpen(allExpanded(), stack, 'capture');
  check('opening a panel expands it and collapses the rest of the stack', eq(opened, { sound: true, vfx: true, capture: false, mod: true }), opened);
  const openedFloat = afterOpen(collapsedWith(['mod']), modesWith(['mod']), 'mod');
  check('opening a floating panel expands it and leaves the stack alone', eq(openedFloat, allExpanded()), openedFloat);

  const dockedAll = afterDockAll(allExpanded(), ['sound', 'vfx', 'capture', 'mod']);
  check('dock-all keeps only the front-most panel expanded', eq(dockedAll, { sound: true, vfx: true, capture: true, mod: false }), dockedAll);
  const dockedAllEmpty = afterDockAll(collapsedWith(['sound']), []);
  check('dock-all with no z-order leaves everything expanded', eq(dockedAllEmpty, allExpanded()), dockedAllEmpty);

  const input = allExpanded();
  afterExpand(input, stack, 'mod');
  afterToggle(input, stack, 'mod');
  afterOpen(input, stack, 'mod');
  check('transitions never mutate their input', eq(input, allExpanded()));

  const zRaised = raiseInOrder(['sound', 'vfx', 'capture', 'mod'], 'vfx');
  check('raise moves a panel to the front', eq(zRaised, ['sound', 'capture', 'mod', 'vfx']), zRaised);
  check('raising the front panel is a no-op', eq(raiseInOrder(['sound', 'vfx'], 'vfx'), ['sound', 'vfx']));
  const zIn: PanelId[] = ['sound', 'vfx'];
  raiseInOrder(zIn, 'sound');
  check('raise does not mutate its input', eq(zIn, ['sound', 'vfx']));
}

function main(): void {
  verifyClamp();
  verifyDetach();
  verifySnap();
  verifyClampAll();
  verifyParseLegit();
  verifyParseHostile();
  verifyAccordion();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
