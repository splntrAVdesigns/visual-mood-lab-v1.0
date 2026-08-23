import { startCopy } from './content';
import styles from './StartStrip.module.css';

/**
 * A "how to actually begin" strip, placed directly under the Hero and
 * above the quadrant grid — Concept sells the idea of the board in full
 * sentences, but doesn't tell a first-time visitor what to literally do
 * first. Deliberately plain text with no glyph — an earlier version
 * carried a small HudGridBullet marker per step (a component that no
 * longer exists — see Quadrant.tsx's HudMicroCluster for where the
 * animated version of this idea actually lives now), but that read as
 * decoration competing with the arrows for attention rather than
 * supporting them; the arrows themselves (styled below) are the only
 * visual element this needs.
 *
 * Location: features/about/StartStrip.tsx
 */
export function StartStrip() {
  return (
    <div className={styles.strip}>
      <ol className={styles.steps}>
        {startCopy.steps.map((step, i) => (
          <li key={step} className={styles.step}>
            <span>{step}</span>
            {i < startCopy.steps.length - 1 && (
              <span className={styles.arrow} aria-hidden="true">
                →
              </span>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}
