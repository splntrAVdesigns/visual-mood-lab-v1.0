/**
 * Sandbox message-gate verifier.
 *
 * Run with: npm run verify:sandbox
 *
 * lib/sandbox/validate-message.ts is the host-side gate for everything a
 * sketch can postMessage out. This checks (1) every message the REAL sandbox
 * sends passes through intact, and (2) the abuse cases it exists for are
 * refused: arbitrary keys, non-image capture URLs (the fetch-with-cookies
 * hole), non-finite / out-of-range numbers, junk shapes.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  MAX_CAPTURE_DATA_URL_CHARS,
  parseSandboxMessage,
  SANDBOX_FORWARDED_KEYS,
} from '../lib/sandbox/validate-message';

let passed = 0;
let failed = 0;
function check(name: string, condition: boolean, detail?: unknown): void {
  if (condition) passed++;
  else {
    failed++;
    console.error(`  FAIL  ${name}${detail !== undefined ? `  -> ${JSON.stringify(detail)}` : ''}`);
  }
}
const p = parseSandboxMessage;

/** A parsed message viewed as a loose record — for asserting on fields the type says may be absent. */
const loose = (m: unknown): Record<string, unknown> | null => (m as Record<string, unknown> | null);

function verifyRealMessages(): void {
  console.log('messages the real sandbox sends pass through intact');

  check('ready', p({ type: 'ready' })?.type === 'ready');
  const schema = p({ type: 'schema', params: { count: { kind: 'slider' } } });
  check('schema with params', schema?.type === 'schema' && (schema.params as Record<string, { kind?: string }> | undefined)?.count?.kind === 'slider');
  const hb = p({ type: 'heartbeat', fps: 59.4, frame: 1204 });
  check('heartbeat', hb?.type === 'heartbeat' && hb.fps === 59.4 && hb.frame === 1204, hb);
  check('error', p({ type: 'error', message: 'boom', stack: 'at x' })?.message === 'boom');
  check('hover true', p({ type: 'hover', hovering: true })?.hovering === true);
  check('hover false', p({ type: 'hover', hovering: false })?.hovering === false);
  check('pluck', p({ type: 'pluck', x: 0.37 })?.x === 0.37);
  check('energy', p({ type: 'energy', energy: 0.5 })?.energy === 0.5);
  for (const key of ['f', 'F', 'Escape']) check(`key ${key}`, p({ type: 'key', key })?.key === key);

  // The exact payload public/sandbox/index.html produces: cv.toDataURL('image/png')
  const png = 'data:image/png;base64,' + 'iVBORw0KGgoAAAANSUhEUgAA'.repeat(40) + '==';
  const cap = p({ type: 'captured', requestId: 7, dataUrl: png });
  check('captured with a real PNG data URL', cap?.type === 'captured' && cap.dataUrl === png && cap.requestId === 7);
  const failedCap = p({ type: 'captured', requestId: 8, dataUrl: null });
  check('captured with dataUrl:null still resolves the waiter (as a failed capture)', failedCap?.type === 'captured' && failedCap.requestId === 8 && failedCap.dataUrl === undefined, failedCap);

  // Keep the two halves of the key allowlist honest: the sandbox's own list must be accepted.
  const html = readFileSync(join(__dirname, '..', 'public', 'sandbox', 'index.html'), 'utf8');
  const forwarded = /FORWARDED_KEYS\s*=\s*\{([^}]*)\}/.exec(html)?.[1] ?? '';
  const sandboxKeys = [...forwarded.matchAll(/(\w+)\s*:\s*true/g)].map((m) => m[1]);
  check('found the sandbox FORWARDED_KEYS list', sandboxKeys.length >= 3, sandboxKeys);
  check('every key the sandbox forwards is accepted by the host', sandboxKeys.every((k) => SANDBOX_FORWARDED_KEYS.has(k)), sandboxKeys);
  check('the host accepts no key the sandbox does not forward', [...SANDBOX_FORWARDED_KEYS].every((k) => sandboxKeys.includes(k)));

  // Every message type the sandbox posts must be one the gate knows.
  const posted = [...html.matchAll(/post\(\{\s*type:\s*'(\w+)'/g)].map((m) => m[1]);
  const known = new Set(['ready', 'schema', 'error', 'heartbeat', 'captured', 'key', 'hover', 'pluck', 'energy']);
  check('the sandbox posts at least the documented types', posted.length >= 9, posted);
  check('the gate handles EVERY type the sandbox posts', posted.every((t) => known.has(t)), posted.filter((t) => !known.has(t)));
}

function verifyAbuse(): void {
  console.log('abuse cases are refused');

  for (const junk of [null, undefined, 0, 1, 'ready', true, [], [{ type: 'ready' }]]) {
    check(`not an object: ${JSON.stringify(junk)}`, p(junk) === null);
  }
  check('no type', p({}) === null);
  check('unknown type', p({ type: 'eval', code: 'alert(1)' }) === null);
  check('type is not a string', p({ type: 5 }) === null);
  check('prototype-ish type', p({ type: '__proto__' }) === null);

  // key: the confused-deputy relay
  for (const key of ['Delete', 'Backspace', 'Enter', 'a', 'Tab', 'F5', 'ArrowLeft', 'f ', 'ff', '']) {
    check(`key ${JSON.stringify(key)} is refused`, p({ type: 'key', key }) === null);
  }
  check('key that is not a string', p({ type: 'key', key: 70 }) === null);
  check('missing key', p({ type: 'key' }) === null);

  // captured: the fetch-with-cookies hole
  for (const dataUrl of [
    '/api/assets',
    '/api/boards/default/items',
    'https://evil.example/x.png',
    'http://169.254.169.254/latest/meta-data',
    'blob:https://app.example/abc',
    'javascript:alert(1)',
    'data:text/html;base64,PHNjcmlwdD4=',
    'data:image/svg+xml;base64,PHN2Zz4=',
    'data:image/png;base64,',
    'data:image/png,not-base64',
    'data:image/png;base64,AAAA<script>',
    'data:image/gif;base64,R0lGODlh',
  ]) {
    const r = p({ type: 'captured', requestId: 1, dataUrl });
    check(`captured dataUrl ${dataUrl.slice(0, 40)} is dropped`, r?.type === 'captured' && r.dataUrl === undefined, r);
  }
  check('captured dataUrl not a string', loose(p({ type: 'captured', requestId: 1, dataUrl: 5 }))?.dataUrl === undefined);
  check('oversized dataUrl is dropped (and never regex-scanned)', loose(p({ type: 'captured', requestId: 1, dataUrl: 'data:image/png;base64,' + 'A'.repeat(MAX_CAPTURE_DATA_URL_CHARS) }))?.dataUrl === undefined);
  check('captured needs an integer requestId', p({ type: 'captured', requestId: 1.5, dataUrl: null }) === null && p({ type: 'captured', dataUrl: null }) === null && p({ type: 'captured', requestId: 'x' }) === null);
  check('captured NaN requestId', p({ type: 'captured', requestId: NaN }) === null);

  // numbers
  check('pluck NaN', p({ type: 'pluck', x: NaN }) === null);
  check('pluck Infinity', p({ type: 'pluck', x: Infinity }) === null);
  check('pluck string', p({ type: 'pluck', x: '0.5' }) === null);
  check('pluck 1e308 is clamped to 1', p({ type: 'pluck', x: 1e308 })?.x === 1);
  check('pluck -5 is clamped to 0', p({ type: 'pluck', x: -5 })?.x === 0);
  check('energy NaN', p({ type: 'energy', energy: NaN }) === null);
  check('energy 9 is clamped to 1', p({ type: 'energy', energy: 9 })?.energy === 1);
  check('heartbeat fps NaN is dropped, message kept', loose(p({ type: 'heartbeat', fps: NaN }))?.fps === undefined && p({ type: 'heartbeat', fps: NaN })?.type === 'heartbeat');
  check('heartbeat fps 1e9 is clamped', p({ type: 'heartbeat', fps: 1e9 })?.fps === 1000);
  check('heartbeat negative frame is floored to 0', p({ type: 'heartbeat', frame: -50 })?.frame === 0);
  check('hover must be literally true', p({ type: 'hover', hovering: 'true' })?.hovering === false && p({ type: 'hover', hovering: 1 })?.hovering === false);

  // schema / error
  check('schema with array params is treated as none', loose(p({ type: 'schema', params: [1, 2] }))?.params === undefined);
  check('schema with string params is treated as none', loose(p({ type: 'schema', params: 'x' }))?.params === undefined);
  const manyKeys = Object.fromEntries(Array.from({ length: 300 }, (_, i) => [`k${i}`, {}]));
  check('schema with 300 params is treated as none', loose(p({ type: 'schema', params: manyKeys }))?.params === undefined);
  const longErr = p({ type: 'error', message: 'x'.repeat(50_000), stack: 'y'.repeat(50_000) });
  check('error message and stack are truncated', (longErr?.message?.length ?? 0) <= 2000 && (longErr?.stack?.length ?? 0) <= 4000, [longErr?.message?.length, longErr?.stack?.length]);
  check('error with non-string message is kept without it', p({ type: 'error', message: { a: 1 } })?.message === undefined);

  // output hygiene: only known fields survive
  const dirty = loose(p({ type: 'pluck', x: 0.5, evil: 'x', __proto__: { polluted: true } }));
  check('unknown extra fields never reach the handler', dirty !== null && !('evil' in dirty) && Object.keys(dirty).sort().join() === 'type,x', dirty && Object.keys(dirty));
  const hostile = Object.defineProperty({}, 'type', {
    get() {
      throw new Error('nope');
    },
  });
  check('a payload whose getter throws is dropped, not thrown', p(hostile) === null);
}

verifyRealMessages();
verifyAbuse();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
