/**
 * Render-pool fault-containment verifier.
 *
 * Run with: npm run verify:render-pool
 *
 * White-box: injects fake entries straight into the pool and drives one
 * tick() by hand — no DOM, no WebGL, no browser. It checks the property the
 * shared render loop has to keep: a fault that belongs to ONE card must never
 * stop the cards after it in the loop, and must not tear down a healthy tile.
 *
 * POOL_MODULE selects the module under test (default: the real pool). Point
 * it at an older copy to watch the same scenarios fail.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

// An (empty) export makes this a module, so its top-level names don't collide
// with the other verify scripts under a whole-project `tsc --noEmit`.
export {};

const g = globalThis as any;
g.requestAnimationFrame = () => 1;
g.cancelAnimationFrame = () => undefined;
g.window = { devicePixelRatio: 1 };
g.HTMLCanvasElement = class HTMLCanvasElement {};

let passed = 0;
let failed = 0;
function check(name: string, condition: boolean, detail?: unknown): void {
  if (condition) passed++;
  else {
    failed++;
    process.stderr.write(`  FAIL  ${name}${detail !== undefined ? `  -> ${JSON.stringify(detail)}` : ''}\n`);
  }
}

interface Probe {
  renders: number;
  entry: any;
}

function makeEntry(cardId: string, opts: { modFault?: boolean; renderFault?: boolean; effectsFault?: boolean } = {}): Probe {
  const probe: Probe = { renders: 0, entry: null };
  const renderer = {
    render() {
      probe.renders++;
      if (opts.renderFault) throw new Error('render exploded');
    },
    getControlSchema() {
      if (opts.modFault) throw new Error('schema exploded');
      return { controls: [] };
    },
    getCanvas() {
      if (opts.effectsFault) throw new Error('canvas exploded');
      return null;
    },
    setParam() {},
    setQuality() {},
    dispose() {},
    play() {},
    pause() {},
  };
  probe.entry = {
    cardId,
    asset: { id: cardId, itemId: cardId, schema: null },
    renderer,
    host: {},
    state: 'preview',
    controller: new AbortController(),
    startedAt: 0,
    lastTime: 0,
    frame: 0,
    promotedAt: 0,
    mounted: true,
    failure: null,
    baseParams: { x: 1 },
    modState: opts.modFault ? { x: { source: 'lfo.sine', amount: 0.5 } } : {},
    soundState: { enabled: false },
    effects: opts.effectsFault ? [{ id: 'fx1', effectType: 'grain', enabled: true, mix: 1, params: {}, mod: {} }] : [],
    size: { width: 100, height: 100 },
    resizeObserver: { disconnect() {} },
  };
  return probe;
}

async function main(): Promise<void> {
  const mod = await import(process.env.POOL_MODULE ?? '../lib/render/pool');
  const pool = mod.getPool() as any;
  // A throw out of an rAF callback is reported by the browser and the NEXT
  // frame still runs (tick() re-arms itself first). Emulate that, so a fault
  // that escapes tick() shows up as skipped cards rather than a crashed test.
  const tick = (now = 1000) => {
    try {
      pool.tick(now);
    } catch {
      /* uncaught error in an rAF callback — the browser logs it and moves on */
    }
  };
  const reset = () => {
    pool.entries.clear();
    pool.faultWarned?.clear();
    pool.trackAudioWarned?.clear();
  };

  const errors: string[] = [];
  const origError = console.error;
  console.error = (...args: unknown[]) => void errors.push(args.map(String).join(' '));

  try {
    // 1. Modulation fault on card A (first in Map order): B must still render, and A too.
    reset();
    let A = makeEntry('A', { modFault: true });
    const B = makeEntry('B');
    pool.entries.set('A', A.entry);
    pool.entries.set('B', B.entry);
    tick();
    check('modulation fault: the card AFTER it still renders', B.renders === 1, B.renders);
    check('modulation fault: the faulting card still renders (unmodulated), not blanked', A.renders === 1, A.renders);
    check('modulation fault: the faulting card is NOT demoted', pool.entries.has('A'));

    // 2. Log-once: the same fault on 5 more frames adds no further log lines.
    errors.length = 0;
    for (let i = 0; i < 5; i++) tick(1000 + i * 16);
    check('repeated fault does not spam the console (once per card+kind)', errors.length === 0, errors);

    // 3. A demoted-then-returning card can warn afresh (bookkeeping was cleared).
    pool.demote('A');
    A = makeEntry('A', { modFault: true });
    pool.entries.set('A', A.entry);
    errors.length = 0;
    tick(2000);
    check('warning bookkeeping is cleared on demote', errors.some((e) => e.includes('modulation failed for A')), errors);

    // 4. A genuinely dead renderer IS demoted, and still doesn't stop the cards after it.
    reset();
    const C = makeEntry('C', { renderFault: true });
    const D = makeEntry('D');
    pool.entries.set('C', C.entry);
    pool.entries.set('D', D.entry);
    tick();
    check('render fault: the dead card is demoted', !pool.entries.has('C'));
    check('render fault: the card after it still renders', D.renders === 1, D.renders);

    // 5. An effects fault must not demote a healthy tile.
    reset();
    const E = makeEntry('E', { effectsFault: true });
    const F = makeEntry('F');
    pool.entries.set('E', E.entry);
    pool.entries.set('F', F.entry);
    tick();
    check('effects fault: the tile is NOT demoted', pool.entries.has('E'));
    check('effects fault: the tile still rendered this frame', E.renders === 1, E.renders);
    check('effects fault: the card after it still renders', F.renders === 1, F.renders);
  } finally {
    console.error = origError;
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
