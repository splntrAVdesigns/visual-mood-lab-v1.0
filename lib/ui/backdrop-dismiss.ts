/**
 * Backdrop-click dismissal, done properly. Pure logic — no React, no DOM — so
 * it can be verified under `tsx` alone (scripts/verify-backdrop-dismiss.ts).
 *
 * THE BUG THIS EXISTS FOR. A modal's backdrop is an ANCESTOR of its panel
 * (backdrop > panel), and the usual "close if the click landed on the
 * backdrop" check is `e.target === e.currentTarget`. But when a mouse press
 * starts inside the panel and is released over the bare backdrop — selecting
 * text and overshooting, dragging out of an input — the browser fires the
 * `click` on the nearest COMMON ANCESTOR of the press and release targets,
 * which is the backdrop. The check passes and the whole dialog closes, though
 * the person never clicked the backdrop.
 *
 * THE RULE. A click dismisses only if the press AND the release both landed
 * on the backdrop (the standard modal behaviour). Track them from
 * pointerdown/pointerup, and look at the click last.
 */

export interface PressState {
  /** Where the last pointer press landed: on the backdrop, or not. `null` = none observed. */
  pressed: boolean | null;
  /** Where the matching release landed. `null` = not observed (yet). */
  released: boolean | null;
}

export const EMPTY_PRESS: PressState = { pressed: null, released: null };

export const recordPress = (onBackdrop: boolean): PressState => ({ pressed: onBackdrop, released: null });

/** A release with no observed press (it began elsewhere) is ignored. */
export const recordRelease = (state: PressState, onBackdrop: boolean): PressState =>
  state.pressed === null ? state : { pressed: state.pressed, released: onBackdrop };

export interface Decision {
  dismiss: boolean;
  /** State to carry forward. Always cleared, so one gesture can never affect the next click. */
  next: PressState;
}

/**
 * Decide whether a `click` dismisses.
 *
 * - Pointer sequence observed: dismiss only if the press and the release both
 *   landed on the backdrop AND the click target is the backdrop. A release that
 *   was never observed is treated as landing on the backdrop, since the click
 *   itself is evidence the sequence completed there.
 * - No pointer sequence observed (a keyboard- or assistive-technology-issued
 *   click, or a press that began inside a cross-origin iframe, which never
 *   reports to this document): fall back to the click target alone — the
 *   behaviour before this module existed, so those paths are unchanged.
 */
export function decideDismiss(state: PressState, clickOnBackdrop: boolean): Decision {
  if (state.pressed === null) return { dismiss: clickOnBackdrop, next: EMPTY_PRESS };
  const dismiss = state.pressed && (state.released ?? true) && clickOnBackdrop;
  return { dismiss, next: EMPTY_PRESS };
}
