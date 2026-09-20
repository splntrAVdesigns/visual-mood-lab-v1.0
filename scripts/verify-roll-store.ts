/**
 * Inspector-store verifier for Roll / Mutate / Undo.
 *
 * Run with: npm run verify:roll-store
 *
 * scripts/verify-roll.ts proves the ENGINE. This proves the wiring around it,
 * against the real Zustand stores with a fake fetch and a fake live renderer:
 *
 *   - a Roll is ONE state update, ONE push to the live renderer and ONE saved
 *     request — however many controls it changed;
 *   - what gets saved passes the server's own PATCH validators (Sprint B);
 *   - Undo / Redo restore the exact previous values AND the "modified" dots;
 *   - a Roll that changes nothing leaves no history entry and saves nothing;
 *   - history is capped, cleared on open/close, and Restore defaults joins it;
 *   - the waveShape -> sound LFO mirroring survives a batch;
 *   - locks and preferences persist locally and survive garbage in storage.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

export {};

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

// ---- environment stubs (must exist before the app modules are imported) ----
const g = globalThis as any;
g.requestAnimationFrame = () => 1;
g.cancelAnimationFrame = () => undefined;
g.window = { devicePixelRatio: 1, addEventListener() {}, removeEventListener() {} };
g.document = { addEventListener() {}, removeEventListener() {}, visibilityState: 'visible' };

const storage = new Map<string, string>();
g.localStorage = {
  getItem: (k: string) => (storage.has(k) ? storage.get(k)! : null),
  setItem: (k: string, v: string) => void storage.set(k, v),
  removeItem: (k: string) => void storage.delete(k),
};

interface Sent {
  url: string;
  body: any;
}
const sent: Sent[] = [];
g.fetch = async (url: string, init: any) => {
  sent.push({ url, body: JSON.parse(init.body) });
  return { ok: true, status: 200, statusText: '' };
};

let passed = 0;
let failed = 0;
function check(name: string, condition: boolean, detail?: unknown): void {
  if (condition) passed++;
  else {
    failed++;
    process.stderr.write(`  FAIL  ${name}${detail !== undefined ? `  -> ${JSON.stringify(detail)}` : ''}\n`);
  }
}
const group = (t: string) => console.log(`\n${t}`);

async function main(): Promise<void> {
  const { parseUniforms } = await import('../lib/gl/parse-uniforms');
  const { paramsToSchema } = await import('../lib/sketch/params-to-schema');
  const { defaultsOf } = await import('../renderers/control-schema');
  const { useInspectorStore } = await import('../stores/inspectorStore');
  const { useRollStore, parseLocks, parsePrefs, DEFAULT_STRENGTH } = await import('../stores/rollStore');
  const { flushAllPersist, retryFailedPersist } = await import('../lib/persist/client');
  const { validateParamState } = await import('../lib/validation/tile-state');
  const { mulberry32, sameValue: _same } = await import('../lib/roll').then((m) => ({ mulberry32: m.mulberry32, sameValue: m.sameValue }));
  const { getPool } = await import('../lib/render/pool');
  const { createSchema } = await import('../renderers/control-schema');
  void _same;

  const seed = join(process.cwd(), 'seed');
  const loadSchema = async (slug: string, type: 'shader' | 'p5', file: string) =>
    type === 'shader'
      ? parseUniforms(readFileSync(join(seed, file), 'utf8'), { schemaId: `shader:${slug}` }).schema
      : paramsToSchema(((await import(pathToFileURL(join(seed, file)).href)) as { params?: unknown }).params, { schemaId: `sketch:${slug}` }).schema;

  const darkMatter = await loadSchema('dark-matter', 'shader', 'shaders/dark-matter.frag');
  const staticChoir = await loadSchema('static-choir', 'p5', 'sketches/static-choir.js');

  const store = useInspectorStore;
  const rolls = useRollStore;
  const flush = async () => {
    flushAllPersist();
    await new Promise((r) => setTimeout(r, 15));
  };
  const open = (schema: typeof darkMatter, slug: string, owned: boolean) => {
    rolls.setState({ locked: new Set() });
    store.getState().openInspector(schema, {}, `default:u:${slug}`, slug, false, {}, owned);
  };
  const patchesTo = (url: string) => sent.filter((s) => s.url === url);
  const { useBoardStore } = await import('../stores/boardStore');
  const boardHas = (itemId: string) => useBoardStore.getState().assets.some((a: { itemId: string }) => a.itemId === itemId);

  // A fake live renderer registered in the real pool, so we can see what the store pushes to it.
  const pool = getPool() as any;
  const liveCalls: Array<Record<string, unknown>> = [];
  const attachRenderer = (itemId: string) => {
    liveCalls.length = 0;
    // Same complete shape scripts/verify-render-pool.ts builds — the real pool
    // reads more fields than the ones this test cares about.
    pool.entries.set(itemId, {
      cardId: itemId,
      asset: { id: itemId, itemId, schema: null },
      renderer: {
        setParams: (p: Record<string, unknown>) => liveCalls.push(p),
        setParam() {},
        getControlSchema: () => ({ controls: [] }),
        dispose() {},
        play() {},
        pause() {},
      },
      host: {},
      state: 'preview',
      controller: new AbortController(),
      startedAt: 0,
      lastTime: 0,
      frame: 0,
      promotedAt: 0,
      mounted: true,
      failure: null,
      baseParams: {},
      modState: {},
      soundState: { enabled: false },
      effects: [],
      size: { width: 100, height: 100 },
      resizeObserver: { disconnect() {} },
    });
  };

  group('updateSchema with nothing open');
  check('updateSchema returns null when no inspector has been opened', useInspectorStore.getState().updateSchema(createSchema('x', [])) === null);

  /* ---------------------------------------------------------------- */
  group('Roll is one update, one renderer push, one save');
  open(darkMatter, 'dark-matter', false);
  attachRenderer('default:u:dark-matter');
  const before = { ...store.getState().params };

  const summary = store.getState().rollParams(mulberry32(7))!;
  const after = store.getState().params;
  check('a Roll changes several controls', summary.changed >= 3, summary);
  check('the store now holds the rolled values', Object.keys(after).some((k) => JSON.stringify(after[k]) !== JSON.stringify(before[k])));
  check('exactly ONE renderer push for the whole Roll', liveCalls.length === 1, liveCalls.length);
  check('...and it carries the complete rolled state', JSON.stringify(liveCalls[0]) === JSON.stringify(after));
  check('the modulation base values follow (so a modulated control breathes around the NEW value)', JSON.stringify(pool.entries.get('default:u:dark-matter').baseParams) === JSON.stringify(after));
  check('one history entry recorded', store.getState().history.past.length === 1);
  check('the modified dots follow the changed controls', store.getState().dirty.size >= 1);

  sent.length = 0;
  await flush();
  const url = '/api/boards/default/items/default:u:dark-matter';
  check('exactly ONE PATCH for the whole Roll', sent.length === 1 && sent[0].url === url, sent.map((s) => s.url));
  check('(a library tile saves to its board-item override, not the shared asset)', patchesTo('/api/assets/dark-matter').length === 0);
  const v = validateParamState(sent[0].body.params);
  check("what was saved passes the server's own PATCH validator", v.ok, v);

  sent.length = 0;
  for (let i = 0; i < 6; i++) store.getState().rollParams(mulberry32(100 + i));
  await flush();
  check('six rapid Rolls still cost a SINGLE PATCH (the save queue coalesces)', sent.length === 1, sent.length);
  check('...carrying the latest state', JSON.stringify(sent[0].body.params) === JSON.stringify(store.getState().params));

  group('an owned asset saves to the asset');
  open(darkMatter, 'dark-matter', true);
  sent.length = 0;
  store.getState().rollParams(mulberry32(3));
  await flush();
  check('owned -> PATCH /api/assets/:id', sent.length === 1 && sent[0].url === '/api/assets/dark-matter', sent.map((s) => s.url));

  /* ---------------------------------------------------------------- */
  group('Undo / Redo');
  open(darkMatter, 'dark-matter', false);
  const start = JSON.parse(JSON.stringify(store.getState().params));
  const startDirty = [...store.getState().dirty];
  store.getState().rollParams(mulberry32(11));
  const rolled = JSON.parse(JSON.stringify(store.getState().params));
  const rolledDirty = [...store.getState().dirty].sort();

  check('Undo reports success', store.getState().undoParams() === true);
  check('Undo restores the EXACT previous values', JSON.stringify(store.getState().params) === JSON.stringify(start));
  check('Undo restores the "modified" dots too', JSON.stringify([...store.getState().dirty]) === JSON.stringify(startDirty));
  check('the undone state is available to Redo', store.getState().history.future.length === 1);
  sent.length = 0;
  await flush();
  check('Undo saves the restored state', sent.length === 1 && JSON.stringify(sent[0].body.params) === JSON.stringify(start));

  check('Redo reports success', store.getState().redoParams() === true);
  check('Redo restores the rolled values exactly', JSON.stringify(store.getState().params) === JSON.stringify(rolled));
  check('...and its dots', JSON.stringify([...store.getState().dirty].sort()) === JSON.stringify(rolledDirty));
  check('nothing left to redo', store.getState().redoParams() === false);

  store.getState().undoParams();
  store.getState().rollParams(mulberry32(12));
  check('a new Roll after an Undo clears Redo (no branching history)', store.getState().history.future.length === 0);

  open(darkMatter, 'dark-matter', false);
  check('Undo with an empty history does nothing', store.getState().undoParams() === false);

  // Undo from a state that ALREADY has modified controls — from an untouched
  // tile the dirty set is empty either way, which can't tell "restored" from "cleared".
  open(darkMatter, 'dark-matter', false);
  store.getState().rollParams(mulberry32(41));
  const midParams = JSON.parse(JSON.stringify(store.getState().params));
  const midDirty = [...store.getState().dirty].sort();
  store.getState().rollParams(mulberry32(42));
  store.getState().undoParams();
  check('the intermediate state has modified dots to lose', midDirty.length > 0, midDirty.length);
  check('Undo from a modified state restores the dots that were there', JSON.stringify([...store.getState().dirty].sort()) === JSON.stringify(midDirty));
  check('...and the exact values', JSON.stringify(store.getState().params) === JSON.stringify(midParams));
  store.getState().redoParams();
  store.getState().undoParams();
  store.getState().undoParams();
  store.getState().redoParams();
  check('Redo restores the dots too (Undo, Undo, Redo lands on the first Roll)', JSON.stringify([...store.getState().dirty].sort()) === JSON.stringify(midDirty));

  group('what is (and is not) recorded');
  open(darkMatter, 'dark-matter', false);
  rolls.setState({ locked: new Set(darkMatter.controls.map((c) => c.id)) });
  await flush(); // drain saves still debouncing from the previous test, so only THIS Roll is measured
  sent.length = 0;
  const locked = store.getState().rollParams(mulberry32(5))!;
  await flush();
  check('with EVERYTHING locked a Roll changes nothing', locked.changed === 0 && locked.eligible === 0, locked);
  check('...records no history entry', store.getState().history.past.length === 0);
  check('...and saves nothing', sent.length === 0);
  check('...and reports how many are locked, so the UI can say why', locked.locked === darkMatter.controls.length, locked.locked);

  open(darkMatter, 'dark-matter', false);
  await flush();
  sent.length = 0;
  const zero = store.getState().mutateParams(0, mulberry32(9))!;
  await flush();
  check('Mutate at strength 0 changes nothing, records nothing, saves nothing', zero.changed === 0 && store.getState().history.past.length === 0 && sent.length === 0);

  open(darkMatter, 'dark-matter', false);
  for (let i = 0; i < 25; i++) store.getState().rollParams(mulberry32(1000 + i));
  check('history is capped at 20 entries', store.getState().history.past.length === 20, store.getState().history.past.length);

  open(darkMatter, 'dark-matter', false);
  store.getState().rollParams(mulberry32(21));
  store.getState().closeInspector();
  check('closing the inspector clears history', store.getState().history.past.length === 0);
  open(darkMatter, 'dark-matter', false);
  store.getState().rollParams(mulberry32(22));
  open(staticChoir, 'static-choir', false);
  check('opening another tile clears history', store.getState().history.past.length === 0);

  group('Restore defaults joins the history');
  open(darkMatter, 'dark-matter', false);
  const pristine = JSON.parse(JSON.stringify(store.getState().params));
  store.getState().resetAll();
  check('Restore defaults on an untouched tile records nothing (no history spam)', store.getState().history.past.length === 0);
  store.getState().rollParams(mulberry32(31));
  const rolled2 = JSON.parse(JSON.stringify(store.getState().params));
  store.getState().resetAll();
  check('Restore defaults goes back to the library defaults', JSON.stringify(store.getState().params) === JSON.stringify(defaultsOf(darkMatter)) && JSON.stringify(rolled2) !== JSON.stringify(pristine));
  store.getState().undoParams();
  check('...and UNDO brings the rolled look back', JSON.stringify(store.getState().params) === JSON.stringify(rolled2));
  store.getState().resetAll();
  store.getState().resetAll();
  check('pressing Restore defaults twice records only once', store.getState().history.past.length === 2, store.getState().history.past.length);

  group('sound LFO mirroring (waveShape) survives a batch');
  open(staticChoir, 'static-choir', false);
  let mirrored = false;
  let shapeChanged = 0;
  for (let i = 1; i <= 80; i++) {
    const beforeShape = store.getState().params.waveShape;
    store.getState().rollParams(mulberry32(i));
    if (store.getState().params.waveShape !== beforeShape) {
      shapeChanged++;
      const { waveShapeValueToLfoShape } = await import('../lib/sound/types');
      mirrored = store.getState().sound.lfoShape === waveShapeValueToLfoShape(store.getState().params.waveShape);
      if (!mirrored) break;
    }
  }
  check('waveShape is rolled on this tile', shapeChanged > 0, shapeChanged);
  check('every time it changed, the sound LFO shape followed', mirrored);

  /* ---------------------------------------------------------------- */
  group('assetType lives in the inspector store (a draft is not on the board)');
  open(darkMatter, 'dark-matter', false);
  check('openInspector without an assetType leaves it null (Roll bar hidden — the safe default)', store.getState().assetType === null);
  store.getState().openInspector(darkMatter, {}, 'default:u:draft', 'draft-1', false, {}, true, undefined, [], 'shader');
  check('openInspector records the asset type', store.getState().assetType === 'shader');
  check('...for an item that is NOT in the board store at all', boardHas('default:u:draft') === false);
  const draftRoll = store.getState().rollParams(mulberry32(3));
  check('Roll works on that draft (nothing reads the board store)', !!draftRoll && draftRoll.changed > 0);

  group('live schema swap (updateSchema)');
  {
    const slider = (id: string, o: Record<string, unknown> = {}) => ({ id, label: id, kind: 'slider', min: 0, max: 10, default: 1, ...o }) as never;
    const A = createSchema('A', [slider('keep'), slider('narrow'), slider('retype'), slider('gone'), slider('lockedKeep')]);
    rolls.setState({ locked: new Set() });
    store.getState().openInspector(A, {}, 'default:u:sw', 'sw', false, {}, false, undefined, [], 'shader');
    attachRenderer('default:u:sw');
    rolls.getState().loadFor('sw');
    rolls.getState().toggleLock('gone');
    rolls.getState().toggleLock('lockedKeep');
    store.getState().rollParams(mulberry32(1)); // one history entry
    store.getState().setParam('keep', 7);
    store.getState().setParam('narrow', 9);
    store.getState().setParam('retype', 7); // valid as a stepper too — so only the carry RULE can reset it
    await flush();

    // ---- presentational-only change
    const beforeParams = JSON.stringify(store.getState().params);
    const A2 = createSchema('A', A.controls.map((c) => ({ ...c, label: `${c.label}!`, hint: 'new hint', group: 'x' }) as never));
    const cosmetic = store.getState().updateSchema(A2)!;
    check('a label / hint / group change is NOT a controls change', cosmetic.controlsChanged === false && cosmetic.added.length + cosmetic.removed.length + cosmetic.retyped.length === 0);
    check('...it keeps Roll\'s undo history', store.getState().history.past.length >= 1);
    check('...and every value', JSON.stringify(store.getState().params) === beforeParams);
    check('...and adopts the new schema object', store.getState().schema === A2);

    // ---- real change
    const B = createSchema('B', [
      slider('keep'),
      slider('narrow', { max: 4 }),
      { id: 'retype', label: 'retype', kind: 'stepper', min: 0, max: 10, default: 1 } as never,
      slider('lockedKeep'),
      slider('fresh', { default: 0.5 }),
    ]);
    const prev = { ...store.getState().params };
    sent.length = 0;
    liveCalls.length = 0;
    const sum = store.getState().updateSchema(B)!;
    const now = store.getState().params;

    check('summary lists what was added / removed / retyped', sum.controlsChanged && JSON.stringify(sum.added) === '["fresh"]' && JSON.stringify(sum.removed) === '["gone"]' && JSON.stringify(sum.retyped) === '["retype"]', sum);
    check('a control that survives (same id + kind) keeps its value', now.keep === prev.keep && now.keep === 7);
    check('a survivor is clamped into a narrower range (9 -> 4)', now.narrow === 4, now.narrow);
    check('a control that changed KIND resets even though 7 would be valid — it takes the new default', now.retype === 1, now.retype);
    check('a new control starts at its default', now.fresh === 0.5);
    check('a removed control is gone from the state', !('gone' in now));
    check('Roll\'s undo history is cleared (an old snapshot could hold a value the new range forbids)', store.getState().history.past.length === 0 && store.getState().history.future.length === 0);
    check('...so Undo does nothing', store.getState().undoParams() === false);
    check('locks on REMOVED controls are pruned, locks on survivors kept', !rolls.getState().locked.has('gone') && rolls.getState().locked.has('lockedKeep'));
    check('the modified dots follow: kept-and-still-different stays, retyped and new do not', store.getState().dirty.has('keep') && !store.getState().dirty.has('retype') && !store.getState().dirty.has('fresh') && !store.getState().dirty.has('gone'), [...store.getState().dirty]);
    check('the live renderer got the new parameters, once', liveCalls.length === 1 && JSON.stringify(liveCalls[0]) === JSON.stringify(now), liveCalls.length);
    check('...and the modulation base values follow', JSON.stringify(pool.entries.get('default:u:sw').baseParams) === JSON.stringify(now));
    await flush();
    check('updateSchema does NOT save — whoever owns the draft owns saving it', sent.length === 0, sent.map((x) => x.url));

    // ---- Roll keeps working on the new schema
    const lockedBefore = store.getState().params.lockedKeep;
    for (let i = 0; i < 20; i++) store.getState().rollParams(mulberry32(50 + i));
    const ids = new Set(B.controls.map((c) => c.id));
    check('after the swap, Roll only ever produces the NEW schema\'s controls', Object.keys(store.getState().params).every((k) => ids.has(k)));
    check('...and still honours a lock that survived the swap', store.getState().params.lockedKeep === lockedBefore);
    check('...within the narrowed range', (store.getState().params.narrow as number) <= 4);

    // ---- pruneLocks in isolation
    const held = rolls.getState().locked;
    rolls.getState().pruneLocks(['keep', 'lockedKeep', 'anything']);
    check('pruneLocks with nothing to drop keeps the SAME Set (no pointless re-render)', rolls.getState().locked === held);
    rolls.getState().pruneLocks(['keep']);
    check('pruneLocks drops exactly the ones that no longer exist, and persists that', !rolls.getState().locked.has('lockedKeep') && JSON.parse(storage.get('vml:roll:locks:sw')!).length === 0);
  }

  /* ---------------------------------------------------------------- */
  group('locks and preferences');
  storage.clear();
  rolls.getState().loadFor('asset-a');
  rolls.getState().toggleLock('speed');
  rolls.getState().setLocks(['a', 'b', 'c'], true);
  check('locks are held in the store', rolls.getState().locked.size === 4);
  check('...and written to local storage under the ASSET id', JSON.parse(storage.get('vml:roll:locks:asset-a')!).length === 4);
  rolls.getState().loadFor('asset-b');
  check('another asset starts unlocked', rolls.getState().locked.size === 0);
  rolls.getState().loadFor('asset-a');
  check('locks come back when the asset is reopened', rolls.getState().locked.has('speed') && rolls.getState().locked.size === 4);
  rolls.getState().setLocks(['a', 'b'], false);
  rolls.getState().toggleLock('speed');
  check('setLocks(false) and toggleLock release', rolls.getState().locked.size === 1 && rolls.getState().locked.has('c'));
  rolls.getState().clearLocks();
  check('clearLocks empties and persists', rolls.getState().locked.size === 0 && JSON.parse(storage.get('vml:roll:locks:asset-a')!).length === 0);

  rolls.getState().setStrength(40);
  rolls.getState().setIncludeToggles(true);
  rolls.getState().loadFor('asset-z');
  check('preferences persist across assets', rolls.getState().strength === 40 && rolls.getState().includeToggles === true);
  rolls.getState().setStrength(1);
  check('strength is clamped to the 5% floor', rolls.getState().strength === 5);
  rolls.getState().setStrength(500);
  check('strength is clamped to the 100% ceiling', rolls.getState().strength === 100);

  check('garbage locks are ignored', parseLocks('nope').size === 0 && parseLocks({ a: 1 }).size === 0 && parseLocks(null).size === 0);
  check('non-string / empty / oversized lock entries are dropped', parseLocks([1, '', 'x'.repeat(200), 'ok', null]).size === 1);
  check('a huge lock list is capped', parseLocks(Array.from({ length: 5000 }, (_, i) => `c${i}`)).size === 512);
  check('garbage prefs fall back to defaults', parsePrefs('x').strength === DEFAULT_STRENGTH && parsePrefs({ strength: 'high', includeToggles: 'yes' }).includeToggles === false);
  check('the default strength is 25%', DEFAULT_STRENGTH === 25);
  storage.set('vml:roll:locks:asset-y', '{not json');
  storage.set('vml:roll:prefs', '{{{');
  rolls.getState().loadFor('asset-y');
  check('corrupt storage does not throw and yields defaults', rolls.getState().locked.size === 0 && rolls.getState().strength === DEFAULT_STRENGTH);

  void retryFailedPersist;
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
