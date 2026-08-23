import styles from './HudMicroCluster.module.css';

const BAR_COUNT = 5;
const LED_COLS = 4;
const LED_ROWS = 3;
const LED_TOTAL = LED_COLS * LED_ROWS;

interface HudMicroClusterProps {
  className?: string;
}

/**
 * The [bars, LED matrix, dial-knob] triplet from HUD Array's Alpha mode
 * (seed/sketches/hud-array.js's drawMicroCluster), reused as a small
 * animated header graphic — one per About-page quadrant (see
 * Quadrant.tsx), not as a per-list-item bullet (an earlier version of
 * this used a static version of the grid glyph for that; this replaces
 * it entirely — see ManifestList.tsx/QuadrantSection.tsx for the plain
 * square bullet that took its place there instead).
 *
 * Pure CSS @keyframes, not a live sketch or a requestAnimationFrame
 * loop — this is a static content page, not a rendered board tile, so
 * there's no per-frame audio/pointer signal to actually drive the
 * original's bars/chase/spin from. The three animations (bar pulse, LED
 * chase, dial spin) are timed independently and drift out of phase with
 * each other over time by design, matching the source sketch's own
 * "every instance gets its own phase/speed offset" principle rather than
 * looking like one single looping clip.
 *
 * Location: components/ui/HudMicroCluster.tsx
 */
export function HudMicroCluster({ className }: HudMicroClusterProps) {
  return (
    <span className={[styles.cluster, className].filter(Boolean).join(' ')} aria-hidden="true">
      <span className={styles.bars}>
        {Array.from({ length: BAR_COUNT }, (_, i) => (
          <span key={i} className={styles.bar} style={{ animationDelay: `${i * 0.13}s` }} />
        ))}
      </span>
      <span className={styles.led}>
        {Array.from({ length: LED_TOTAL }, (_, i) => (
          <span key={i} className={styles.ledCell} style={{ animationDelay: `${i * 0.09}s` }} />
        ))}
      </span>
      <span className={styles.dial}>
        <span className={styles.dialNeedle} />
      </span>
    </span>
  );
}
