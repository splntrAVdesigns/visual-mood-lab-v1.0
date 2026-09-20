/**
 * Save-queue verifier.
 *
 * Run with: npm run verify:persist
 *
 * Drives lib/persist/client.ts against a fake fetch and fake window/document —
 * no browser, no network. Covers what the queue exists to guarantee:
 *   - a debounced edit is never lost when the page goes away (flush),
 *   - a failed save is REMEMBERED and surfaced, and retried correctly,
 *   - a retry can never resend stale data over a newer edit.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

// An (empty) export makes this a module, so its top-level names don't collide
// with the other verify scripts under a whole-project `tsc --noEmit`.
export {};

interface Call {
  url: string;
  body: any;
  keepalive: boolean;
}

const g = globalThis as any;
const calls: Call[] = [];
let respond: (call: Call) => { status: number } | 'throw' = () => ({ status: 200 });

g.fetch = async (url: string, init: any) => {
  const call: Call = { url, body: JSON.parse(init.body), keepalive: init.keepalive === true };
  calls.push(call);
  const r = respond(call);
  if (r === 'throw') throw new TypeError('Failed to fetch');
  return { ok: r.status >= 200 && r.status < 300, status: r.status, statusText: '' };
};

// Minimal window/document so attachPersistLifecycle can be exercised.
const handlers: Record<string, Array<() => void>> = {};
const add = (type: string, fn: () => void) => void (handlers[type] ??= []).push(fn);
const remove = (type: string, fn: () => void) => void (handlers[type] = (handlers[type] ?? []).filter((h) => h !== fn));
const fire = (type: string) => (handlers[type] ?? []).slice().forEach((h) => h());
let visibility: 'visible' | 'hidden' = 'visible';
g.window = { addEventListener: add, removeEventListener: remove };
g.document = {
  addEventListener: add,
  removeEventListener: remove,
  get visibilityState() {
    return visibility;
  },
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
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const tick = () => sleep(15); // let fetch().then() chains settle
const DELAY = 25;

async function main(): Promise<void> {
  const c = await import('../lib/persist/client');
  const reset = async () => {
    c.flushAllPersist();
    await tick();
    // Clear any failures from the previous case: fail-free resend of everything.
    respond = () => ({ status: 200 });
    c.retryFailedPersist();
    await tick();
    calls.length = 0;
  };
  const errors: string[] = [];
  const origError = console.error;
  console.error = (...a: unknown[]) => void errors.push(a.map(String).join(' '));

  try {
    console.log('debounce + flush');
    await reset();
    c.persistParams('a1', { x: 1 }, DELAY);
    c.persistParams('a1', { x: 2 }, DELAY);
    c.persistParams('a1', { x: 3 }, DELAY);
    await sleep(DELAY * 3);
    check('three quick edits -> ONE PATCH carrying the last value', calls.length === 1 && calls[0].body.params.x === 3, calls);
    check('PATCH goes to /api/assets/:id', calls[0]?.url === '/api/assets/a1');
    check('initial sends use keepalive', calls[0]?.keepalive === true);

    await reset();
    c.persistParams('a2', { p: 1 }, 10_000);
    c.persistSnapshotParams('s2', { p: 2 }, 10_000);
    c.persistMod('m2', 'a2', { c: { source: 'time', amount: 1 } } as any, false, 10_000);
    c.persistSound('so2', 'a2', { enabled: true } as any, true, 10_000);
    c.persistEffects('e2', 'a2', [] as any, false, 10_000);
    check('nothing is sent while the debounce is running', calls.length === 0);
    c.flushAllPersist();
    await tick();
    check('flushAllPersist sends ALL five kinds immediately', calls.length === 5, calls.map((x) => x.url));
    const byUrl = (u: string) => calls.filter((x) => x.url === u);
    check('params -> /api/assets/a2 {params}', byUrl('/api/assets/a2').some((x) => x.body.params?.p === 1));
    check('snapshot -> /api/boards/default/items/s2 {params}', byUrl('/api/boards/default/items/s2').some((x) => x.body.params?.p === 2));
    check('mod (asset path) -> /api/assets/a2 {mod}', byUrl('/api/assets/a2').some((x) => x.body.mod));
    check('sound (board-item path) -> /api/boards/default/items/so2 {sound}', byUrl('/api/boards/default/items/so2').some((x) => x.body.sound?.enabled === true));
    check('effects (asset path) -> /api/assets/a2 {effects}', byUrl('/api/assets/a2').some((x) => Array.isArray(x.body.effects)));
    check('every flush send used keepalive', calls.every((x) => x.keepalive));
    const before = calls.length;
    await sleep(60);
    check('flush is idempotent — the old timers do not fire a second time', calls.length === before, calls.length);
    c.flushAllPersist();
    await tick();
    check('flushing again with nothing pending sends nothing', calls.length === before);

    console.log('onSaved semantics (used by the inspector to sync the board store)');
    await reset();
    const seen: string[] = [];
    c.persistParams('a3', { v: 1 }, DELAY, (p) => seen.push(`persist:${p.v}`));
    await sleep(DELAY * 3);
    check('timer path calls the persist-time onSaved', seen.join() === 'persist:1', seen);
    c.persistParams('a3', { v: 2 }, 10_000, (p) => seen.push(`persist2:${p.v}`));
    c.flushParams('a3', (p) => seen.push(`flush:${p.v}`));
    await tick();
    check('flushParams(id, onSaved) calls the flush-time callback', seen.includes('flush:2') && !seen.includes('persist2:2'), seen);

    console.log('failure tracking');
    await reset();
    const statuses: Array<{ failed: number; sessionExpired: boolean }> = [];
    const unsub = c.subscribePersistStatus(() => statuses.push({ ...c.getPersistStatus() }));
    check('starts with no failures', c.getPersistStatus().failed === 0);
    const idle = c.getPersistStatus();
    check('snapshot is referentially stable while nothing changes', c.getPersistStatus() === idle);
    check('server snapshot is "no failures"', c.getServerPersistStatus().failed === 0);

    respond = () => ({ status: 500 });
    c.persistParams('f1', { x: 1 }, DELAY);
    await sleep(DELAY * 3);
    check('a 500 is recorded as a failed save', c.getPersistStatus().failed === 1, c.getPersistStatus());
    check('subscribers were notified', statuses.length >= 1);
    check('a 500 is not "session expired"', c.getPersistStatus().sessionExpired === false);
    check('the failure was still logged to the console', errors.some((e) => e.includes('[persist]')), errors);

    respond = () => ({ status: 200 });
    c.retryFailedPersist();
    await tick();
    check('Retry resends and, on success, clears the failure', c.getPersistStatus().failed === 0, c.getPersistStatus());
    check('the retry resent the same body', calls.at(-1)?.url === '/api/assets/f1' && calls.at(-1)?.body.params.x === 1, calls.at(-1));
    check('a retry does NOT use keepalive', calls.at(-1)?.keepalive === false);

    console.log('stale-data safety');
    await reset();
    respond = () => ({ status: 503 });
    c.persistParams('f2', { v: 'old' }, DELAY);
    await sleep(DELAY * 3);
    check('setup: v=old failed', c.getPersistStatus().failed === 1);
    respond = () => ({ status: 200 });
    c.persistParams('f2', { v: 'new' }, 10_000); // newer edit, still debouncing
    check('a newer edit for the same key drops the failed one', c.getPersistStatus().failed === 0, c.getPersistStatus());
    calls.length = 0;
    c.retryFailedPersist();
    await tick();
    check('so a Retry can never resend the OLD value', calls.length === 0, calls);
    c.flushAllPersist();
    await tick();
    check('and the NEW value is what gets saved', calls.length === 1 && calls[0].body.params.v === 'new', calls);

    console.log('401 / network / retryable classification');
    await reset();
    respond = () => ({ status: 401 });
    c.persistMod('m1', 'a1', { c: { source: 'time', amount: 1 } } as any, false, DELAY);
    await sleep(DELAY * 3);
    check('401 -> failed + sessionExpired', c.getPersistStatus().failed === 1 && c.getPersistStatus().sessionExpired === true, c.getPersistStatus());
    calls.length = 0;
    c.retryFailedPersist({ onlyRetryable: true });
    await tick();
    check('automatic retry SKIPS a 401 (needs a new session, not a retry)', calls.length === 0, calls);
    check('the 401 failure is still shown', c.getPersistStatus().failed === 1);
    respond = () => ({ status: 200 });
    c.retryFailedPersist();
    await tick();
    check('the Retry button resends everything, incl. a 401', calls.length === 1 && c.getPersistStatus().failed === 0, calls);

    await reset();
    respond = () => 'throw';
    c.persistSound('n1', 'a1', { enabled: true } as any, true, DELAY);
    await sleep(DELAY * 3);
    check('a network error (no response) is recorded', c.getPersistStatus().failed === 1);
    respond = () => ({ status: 200 });
    calls.length = 0;
    c.retryFailedPersist({ onlyRetryable: true });
    await tick();
    check('a network error IS retried automatically', calls.length === 1 && c.getPersistStatus().failed === 0, calls);

    await reset();
    respond = () => ({ status: 400 });
    c.persistEffects('v1', 'a1', [] as any, false, DELAY);
    await sleep(DELAY * 3);
    calls.length = 0;
    respond = () => ({ status: 200 });
    c.retryFailedPersist({ onlyRetryable: true });
    await tick();
    check('a 400 (will fail identically forever) is NOT auto-retried', calls.length === 0);
    check('...but it is still surfaced', c.getPersistStatus().failed === 1);
    c.retryFailedPersist();
    await tick();

    await reset();
    respond = () => ({ status: 429 });
    c.persistParams('r1', { x: 1 }, DELAY);
    await sleep(DELAY * 3);
    respond = () => ({ status: 200 });
    calls.length = 0;
    c.retryFailedPersist({ onlyRetryable: true });
    await tick();
    check('429 is treated as retryable', calls.length === 1);
    unsub();

    console.log('lifecycle');
    await reset();
    const detach = c.attachPersistLifecycle();
    check('registers pagehide, visibilitychange and online', ['pagehide', 'visibilitychange', 'online'].every((t) => (handlers[t]?.length ?? 0) === 1));

    c.persistParams('l1', { x: 1 }, 10_000);
    fire('pagehide');
    await tick();
    check('pagehide flushes a pending edit', calls.length === 1 && calls[0].keepalive === true, calls);

    calls.length = 0;
    c.persistMod('l2', 'a1', { c: { source: 'time', amount: 1 } } as any, false, 10_000);
    visibility = 'hidden';
    fire('visibilitychange');
    await tick();
    check('tab hidden (mobile background) flushes a pending edit', calls.length === 1, calls);

    respond = () => 'throw';
    c.persistSound('l3', 'a1', { enabled: true } as any, false, DELAY);
    await sleep(DELAY * 3);
    respond = () => ({ status: 200 });
    calls.length = 0;
    visibility = 'visible';
    fire('visibilitychange');
    await tick();
    check('tab visible again retries what failed while away', calls.length === 1 && c.getPersistStatus().failed === 0, calls);

    respond = () => 'throw';
    c.persistSound('l4', 'a1', { enabled: true } as any, false, DELAY);
    await sleep(DELAY * 3);
    respond = () => ({ status: 200 });
    calls.length = 0;
    fire('online');
    await tick();
    check('coming back online retries what failed', calls.length === 1 && c.getPersistStatus().failed === 0, calls);

    detach();
    check('cleanup removes every listener', ['pagehide', 'visibilitychange', 'online'].every((t) => (handlers[t]?.length ?? 0) === 0));
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
