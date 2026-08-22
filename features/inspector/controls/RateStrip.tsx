'use client';

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
 * already in effect. The slider is always interactive: on a fixed
 * division it's a preview/fine-tune that immediately kicks the selection
 * over to "Hz" the moment it's touched, rather than sitting there looking
 * live while silently doing nothing.
 */
export function RateStrip({ hz, onChange, disabled = false, label }: RateStripProps) {
  const active = hzToDivision(hz);

  const selectDivision = (division: LfoRateDivision) => {
    if (division === 'hz') {
      // No rate change on its own — see the component doc. Only matters
      // when the current rate happens to sit exactly on a fixed division
      // already: active !== 'hz' would otherwise leave the strip showing
      // "Hz" highlighted while the slider still reads the old division's
      // value, which is correct, but worth this explicit no-op rather
      // than a fallthrough that looks accidental.
      return;
    }
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
        // Any drag switches the strip to Hz mode implicitly, by virtue of
        // the new value very likely no longer landing on a fixed
        // division — see hzToDivision's tolerance. No separate mode flag
        // to keep in sync; the displayed active button is always just a
        // read of the current Hz value.
        onChange={onChange}
      />
      <div className={s.rateStripReadout}>{formatValue(hz, 0.01)} Hz</div>
    </div>
  );
}
