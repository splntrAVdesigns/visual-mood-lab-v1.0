/**
 * Backdrop-dismiss verifier.
 *
 * Run with: npm run verify:backdrop-dismiss
 *
 * Covers lib/ui/backdrop-dismiss.ts — the decision behind every modal
 * backdrop that closes on click (focused view, command palette, Dialog).
 *
 * The two directions, and the first matters more:
 *
 *   1. A REAL BACKDROP CLICK MUST ALWAYS DISMISS. A press and release both on
 *      the backdrop, and the keyboard/assistive/iframe fallback where no
 *      pointer sequence is observed, must behave exactly as before.
 *   2. A GESTURE THAT DID NOT BEGIN AND END ON THE BACKDROP MUST NEVER
 *      DISMISS — the reported bug: press inside a panel (or on the tile),
 *      release over the bare backdrop, and the browser fires the click on
 *      their common ancestor, the backdrop.
 *
 * Plus: no gesture may ever affect the next click.
 */

import {
  EMPTY_PRESS,
  decideDismiss,
  recordPress,
  recordRelease,
  type PressState,
} from '../lib/ui/backdrop-dismiss';

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

/** Run a full gesture: press (on backdrop?), release (on backdrop?), then the click's target. */
function gesture(pressOnBackdrop: boolean, releaseOnBackdrop: boolean, clickOnBackdrop: boolean) {
  let state: PressState = recordPress(pressOnBackdrop);
  state = recordRelease(state, releaseOnBackdrop);
  return decideDismiss(state, clickOnBackdrop);
}

function verifyRealClicks(): void {
  group('a real backdrop click always dismisses');
  check('press + release + click all on the backdrop → dismiss', gesture(true, true, true).dismiss === true);

  group('keyboard / assistive-technology / cross-origin-iframe clicks (no pointer sequence) — unchanged');
  check('a click on the backdrop with no pointer sequence → dismiss (old behaviour)', decideDismiss(EMPTY_PRESS, true).dismiss === true);
  check('a click on content with no pointer sequence → no dismiss', decideDismiss(EMPTY_PRESS, false).dismiss === false);
  check('a release with no observed press is ignored (falls back to the click target)', decideDismiss(recordRelease(EMPTY_PRESS, true), true).dismiss === true);
  check('…and does not conjure a dismissal from a content click', decideDismiss(recordRelease(EMPTY_PRESS, false), false).dismiss === false);
}

function verifyBug(): void {
  group('the reported bug: a gesture that did not begin AND end on the backdrop never dismisses');
  // The browser fires `click` on the common ancestor (the backdrop), so clickOnBackdrop is TRUE in all of these.
  check('press INSIDE, release on the backdrop, click lands on the backdrop → no dismiss', gesture(false, true, true).dismiss === false);
  check('press on the backdrop, release INSIDE, click lands on the backdrop → no dismiss', gesture(true, false, true).dismiss === false);
  check('press INSIDE, release INSIDE (e.g. a slider drag captured elsewhere) → no dismiss', gesture(false, false, true).dismiss === false);
  check('press INSIDE, release inside, click on content → no dismiss', gesture(false, false, false).dismiss === false);
  check('press + release on the backdrop but the click target is content → no dismiss (belt and braces)', gesture(true, true, false).dismiss === false);

  // Exhaustive: only ONE combination of the three may dismiss.
  let dismissing = 0;
  for (const p of [true, false]) for (const r of [true, false]) for (const c of [true, false]) if (gesture(p, r, c).dismiss) dismissing++;
  check('exhaustive: exactly 1 of 8 press/release/click combinations dismisses', dismissing === 1, dismissing);
}

function verifyUnobservedRelease(): void {
  group('a release that was never observed');
  const noRelease = decideDismiss(recordPress(true), true);
  check('press on the backdrop, release never observed, click on the backdrop → dismiss (the click is the evidence)', noRelease.dismiss === true);
  const noReleaseInside = decideDismiss(recordPress(false), true);
  check('press INSIDE, release never observed, click on the backdrop → no dismiss', noReleaseInside.dismiss === false);
}

function verifyNoLeakage(): void {
  group('no gesture ever affects the next click');
  const ignored = gesture(false, true, true);
  check('an ignored gesture returns cleared state', ignored.next.pressed === null && ignored.next.released === null, ignored.next);
  const dismissed = gesture(true, true, true);
  check('a dismissing gesture returns cleared state', dismissed.next.pressed === null && dismissed.next.released === null, dismissed.next);
  check('after an ignored gesture, a plain click-with-no-sequence still works', decideDismiss(ignored.next, true).dismiss === true);

  // A new press always replaces whatever came before it.
  let state = recordPress(false);
  state = recordRelease(state, false);
  state = recordPress(true);
  check('a new press clears the previous release', state.released === null && state.pressed === true, state);
  check('…so a stale inside-release cannot leak into the new gesture', decideDismiss(recordRelease(state, true), true).dismiss === true);

  // pointercancel handling in the hook resets to EMPTY_PRESS.
  check('after a cancelled gesture (state reset), a keyboard click on the backdrop dismisses', decideDismiss(EMPTY_PRESS, true).dismiss === true);
}

function verifyPurity(): void {
  group('purity');
  const before: PressState = { pressed: true, released: null };
  const snapshot = JSON.stringify(before);
  recordRelease(before, false);
  decideDismiss(before, true);
  check('functions never mutate the state they are given', JSON.stringify(before) === snapshot);
  check('EMPTY_PRESS is never mutated by use', EMPTY_PRESS.pressed === null && EMPTY_PRESS.released === null);
}

function main(): void {
  verifyRealClicks();
  verifyBug();
  verifyUnobservedRelease();
  verifyNoLeakage();
  verifyPurity();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
