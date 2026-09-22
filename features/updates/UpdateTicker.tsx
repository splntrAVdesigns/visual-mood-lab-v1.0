'use client';

import { useLayoutEffect, useRef, useState } from 'react';
import { CloseIcon, IconButton } from '@/components/ui';
import { latestUpdate } from './content';
import {
  UPDATE_DISMISSAL_KEY,
  formatUpdateDate,
  formatUpdateItems,
  shouldShowUpdate,
} from '@/lib/updates/dismissal';
import s from './updateTicker.module.css';

function readDismissedDate(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(UPDATE_DISMISSAL_KEY);
  } catch {
    return null;
  }
}

function writeDismissedDate(date: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(UPDATE_DISMISSAL_KEY, date);
  } catch {
    // Private browsing / storage disabled — the banner just won't stay dismissed.
  }
}

/** How fast the text reads, in pixels per second — independent of message length or window width. */
const PX_PER_SECOND = 70;
/** The floor on a pass's duration, so a very short message doesn't blink past. */
const MIN_DURATION_S = 8;
/** Portion of each cycle spent actually crossing the window; the rest is the off-screen pause (see the CSS keyframe). */
const CROSSING_FRACTION = 0.65;

/**
 * A thin "what's new" strip between the header and the hero: a static
 * "Latest update: <date>" label, a small bounded LED-style window that
 * scrolls the update items right to left and pauses off-screen between
 * passes, and a dismiss button.
 *
 * Dismissing it collapses it to a slim clickable tab rather than removing
 * it from the page. Clicking that tab re-expands the full banner, any
 * time — this only sets local `expanded` state; it does NOT clear the
 * underlying dismissal, so a fresh page load after dismissing still starts
 * collapsed (no nagging on every visit), but there is always something in
 * that spot to click if you want to see it again. Only the dismiss button
 * itself writes the dismissal.
 *
 * Deliberately its own full-width bar in normal flow, not a corner overlay
 * on the hero or an addition to the header:
 *   - The hero has no free corner on mobile — its subtitle already reaches
 *     near the card's bottom edge there (measured at 360–390px widths).
 *   - The header is already at capacity: search and the onboarding CTA are
 *     both dropped below 720px just to keep it from overflowing.
 * A full-width bar has neither problem and needs no per-breakpoint
 * corner logic.
 *
 * The collapsed tab (like the full banner) reappears automatically the
 * next time `latestUpdate.date` in content.ts is bumped, even for someone
 * who dismissed a previous update — see lib/updates/dismissal.ts.
 */
export function UpdateTicker() {
  // Two-phase mount: render nothing until the client has read localStorage,
  // so the server output (nothing) matches the first client render (also
  // nothing) — no hydration mismatch, and no flash of the full banner for
  // someone who already dismissed it.
  const [hydrated, setHydrated] = useState(false);
  // Session-only: whether the FULL ticker is showing right now, as opposed
  // to the collapsed tab. Seeded once from the persisted dismissal below;
  // toggled afterwards by the collapsed tab (expand) and the dismiss
  // button (collapse) without re-reading storage.
  const [expanded, setExpanded] = useState(false);
  const windowRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    setExpanded(shouldShowUpdate(latestUpdate.date, readDismissedDate()));
    setHydrated(true);
  }, []);

  // Measure the window and text widths and derive the scroll distance and
  // duration from them, so the pass always starts fully off the window's
  // right edge and ends fully off its left edge, at a steady reading speed,
  // regardless of message length or how wide the window renders. Skipped
  // entirely under reduced motion — the CSS media query already turns the
  // scroll off and truncates the text instead, so there's nothing to measure.
  useLayoutEffect(() => {
    if (!hydrated || !expanded) return;
    const windowEl = windowRef.current;
    const trackEl = trackRef.current;
    if (!windowEl || !trackEl) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const measure = () => {
      const windowWidth = windowEl.clientWidth;
      const textWidth = trackEl.scrollWidth;
      const crossingSeconds = Math.max(MIN_DURATION_S, (windowWidth + textWidth) / PX_PER_SECOND);
      trackEl.style.setProperty('--ticker-start', `${windowWidth}px`);
      trackEl.style.setProperty('--ticker-end', `${-textWidth}px`);
      trackEl.style.setProperty('--ticker-duration', `${crossingSeconds / CROSSING_FRACTION}s`);
    };

    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(windowEl);
    return () => ro.disconnect();
  }, [hydrated, expanded]);

  if (!hydrated) return null;

  if (!expanded) {
    return (
      <button
        type="button"
        className={s.collapsed}
        onClick={() => setExpanded(true)}
        aria-label={`Show latest update — ${formatUpdateDate(latestUpdate.date)}`}
      >
        <span className={s.collapsedDot} aria-hidden="true" />
        Latest update
      </button>
    );
  }

  return (
    <div className={s.ticker} role="group" aria-label="Latest update">
      <span className={s.label}>
        Latest update: <span className={s.date}>{formatUpdateDate(latestUpdate.date)}</span>
      </span>
      <div ref={windowRef} className={s.window}>
        <div ref={trackRef} className={s.track}>
          {formatUpdateItems(latestUpdate.items)}
        </div>
      </div>
      <IconButton
        label="Dismiss update banner"
        icon={<CloseIcon />}
        className={s.dismiss}
        onClick={() => {
          writeDismissedDate(latestUpdate.date);
          setExpanded(false);
        }}
      />
    </div>
  );
}
