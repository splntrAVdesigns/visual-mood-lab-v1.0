'use client';

import { useState } from 'react';
import { Slider, formatValue } from '@/components/ui';
import { CUSTOM_HZ_MAX, CUSTOM_HZ_MIN, RATE_DIVISIONS, divisionToHz, hzToDivision, type LfoRateDivision } from '@/lib/modulation/lfo';
import s from '../../features.module.css';

interface RateStripProps {
  /** The only thing actually persisted — see lib/modulation/lfo.ts for why
      there's no separate stored "division" field. */
  hz: number;
  onChange: (hz: number) => void;
  disabled?: boolean;
  label: string;
}

/**
 * A 6-button rate-division strip (1/1, 1/2, 1/4, 1/8, 1/16, Hz) plus a Hz
 * slider underneath — the modulation-rate counterpart to NoteRack's
 * chromatic strip, same flush-cell visual language on purpose so the two
 * read as siblings rather than two different widget systems.
 *
 * Tapping a fixed division snaps `hz` straight to that division's exact
 * rate. Tapping "Hz" doesn't change the rate at all — it just switches the
 * slider below into free-entry mode, starting from whatever Hz was
 * already in effect.
 *
 * BUGFIX (post-Part-1 testing): "active" used to be purely derived from
 * `hzToDivision(hz)` — no separate mode flag, by design, per this
 * component's own original doc. That's correct right up until the
 * current rate happens to sit exactly on a fixed division's value: then
 * `hzToDivision` reports that division regardless of what's clicked, so
 * tapping "Hz" was a genuine no-op with no way to ever show it selected —
 * styled identically to the other five buttons (same aria-pressed,
 * data-selected treatment), so it looked clickable and silently wasn't.
 * `explicitHz` is the minimum state needed to fix that without losing the
 * original "derive from value" behavior in every other case: it only
 * overrides the derivation when someone has explicitly tapped Hz, clears
 * the moment a real division is tapped instead, and is irrelevant (never
 * even read) for the common case where hz doesn't land on a division at
 * all — which still "just works" exactly as before, no regression there.
 */
export function RateStrip({ hz, onChange, disabled = false, label }: RateStripProps) {
  const derived = hzToDivision(hz);
  const [explicitHz, setExplicitHz] = useState(false);
  const active = explicitHz && derived !== 'hz' ? 'hz' : derived;

  const selectDivision = (division: LfoRateDivision) => {
    if (division === 'hz') {
      // Still no rate change on its own — see the component doc above.
      // The only thing this needs to do now is make the strip actually
      // SHOW Hz as selected, which the old version never could.
      setExplicitHz(true);
      return;
    }
    setExplicitHz(false);
    onChange(divisionToHz(division, hz));
  };

  return (
    // data-disabled on the shared wrapper, not passed into Slider
    // individually — matches NoteRack's own pattern (opacity + pointer-
    // events at the container level) rather than assuming Slider exposes
    // a disabled prop of its own.
    <div className={s.rateStripWrap} data-disabled={disabled ? 'true' : undefined}>
      <div className={s.rateStrip} role="group" aria-label={`${label} rate division`}>
        {RATE_DIVISIONS.map((d) => (
          <button
            key={d.value}
            type="button"
            className={s.rateStripKey}
            aria-pressed={active === d.value}
            aria-label={d.value === 'hz' ? 'Custom Hz' : `${d.label} rate`}
            disabled={disabled}
            data-selected={active === d.value ? 'true' : undefined}
            onClick={() => selectDivision(d.value)}
          >
            {d.label}
          </button>
        ))}
      </div>

      <Slider
        label={`${label} rate in Hz`}
        value={hz}
        min={CUSTOM_HZ_MIN}
        max={CUSTOM_HZ_MAX}
        step={0.01}
        scale="log"
        // Any drag switches the strip to Hz mode — explicitly now, not
        // just implicitly via the value no longer matching a division
        // (which was the ONLY mechanism before, and exactly the thing
        // that couldn't fire when the drag started and ended on the same
        // division's value without crossing off it).
        onChange={(v) => {
          setExplicitHz(true);
          onChange(v);
        }}
      />
      <div className={s.rateStripReadout}>{formatValue(hz, 0.01)} Hz</div>
    </div>
  );
}
