/**
 * "Latest Update" ticker verifier.
 *
 * Run with: npm run verify:update-ticker
 *
 * Covers lib/updates/dismissal.ts — whether the banner shows, and its two
 * small formatters. Same two directions as the other verifiers in this repo:
 *
 *   1. A REAL DISMISSAL MUST STICK. Dismissing today's update and reloading
 *      with today's date still stored must not show it again.
 *   2. A NEW UPDATE MUST ALWAYS SHOW, even with garbage or a stale value
 *      sitting in storage — the function must fail open (show it), never
 *      throw, and never mistake a near-miss for a match.
 */

import { formatUpdateDate, formatUpdateItems, shouldShowUpdate } from '../lib/updates/dismissal';

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

function verifyShouldShow(): void {
  group('shouldShowUpdate — a real dismissal sticks');
  check('exact match → hidden', shouldShowUpdate('2026-09-21', '2026-09-21') === false);

  group('shouldShowUpdate — a new or different update always shows');
  check('no stored value (null) → shown', shouldShowUpdate('2026-09-21', null) === true);
  check('no stored value (undefined) → shown', shouldShowUpdate('2026-09-21', undefined) === true);
  check('empty string → shown', shouldShowUpdate('2026-09-21', '') === true);
  check('an older dismissed date → shown', shouldShowUpdate('2026-09-21', '2026-09-14') === true);
  check('a later dismissed date (clock skew) → still shown, not "already seen"', shouldShowUpdate('2026-09-21', '2026-10-01') === true);
  check('trailing whitespace is NOT normalised away → shown', shouldShowUpdate('2026-09-21', '2026-09-21 ') === true);
  check('a near-miss (off by one character) → shown, not treated as a match', shouldShowUpdate('2026-09-21', '2026-09-22') === true);

  group('shouldShowUpdate — hostile / wrong-typed storage never throws, fails open');
  for (const [name, raw] of [
    ['a number', 20260921],
    ['a boolean', true],
    ['an array', ['2026-09-21']],
    ['an object', { date: '2026-09-21' }],
    ['NaN', NaN],
    ['a function', () => '2026-09-21'],
  ] as const) {
    check(`${name} → shown, not treated as a match`, shouldShowUpdate('2026-09-21', raw) === true);
  }
  let threw = false;
  try {
    for (const junk of [null, undefined, 1, Symbol.iterator, {}, []]) shouldShowUpdate('2026-09-21', junk);
  } catch {
    threw = true;
  }
  check('never throws, whatever storage held', !threw);
}

function verifyFormatDate(): void {
  group('formatUpdateDate');
  check('a clean ISO date reformats to MM/DD/YYYY', formatUpdateDate('2026-09-21') === '09/21/2026');
  check('single-digit month/day still zero-padded correctly', formatUpdateDate('2026-01-05') === '01/05/2026');

  group('formatUpdateDate — malformed input passes through unchanged, never NaN');
  for (const bad of ['', 'not-a-date', '2026/09/21', '2026-9-21', '2026-09-21T00:00:00Z', '09-21-2026']) {
    const out = formatUpdateDate(bad);
    check(`"${bad}" → returned unchanged`, out === bad, out);
    check(`"${bad}" → never contains "NaN"`, !out.includes('NaN'), out);
  }
}

function verifyFormatItems(): void {
  group('formatUpdateItems');
  check('joins multiple items with the separator', formatUpdateItems(['A', 'B', 'C']) === 'A   ·   B   ·   C');
  check('a single item has no separator', formatUpdateItems(['Only one']) === 'Only one');
  check('an empty list formats to an empty string', formatUpdateItems([]) === '');
  check('blank / whitespace-only entries are dropped', formatUpdateItems(['A', '  ', '', 'B']) === 'A   ·   B');
  check('surrounding whitespace on real entries is trimmed', formatUpdateItems(['  A  ', 'B']) === 'A   ·   B');
  check('all-blank input formats to an empty string, not a lone separator', formatUpdateItems(['', '  ', '\t']) === '');
}

function main(): void {
  verifyShouldShow();
  verifyFormatDate();
  verifyFormatItems();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
