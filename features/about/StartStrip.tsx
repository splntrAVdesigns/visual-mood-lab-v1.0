import { HudGridBullet } from '@/components/ui/HudGridBullet';
import { startCopy } from './content';
import styles from './StartStrip.module.css';

/**
 * A five-step "how to actually begin" strip, placed directly under the
 * Hero and above the quadrant grid — Concept sells the idea of the board
 * in full sentences, but doesn't tell a first-time visitor what to
 * literally do first. Kept to the same mono-manifest visual language as
 * ManifestList/HudGridBullet rather than introducing a separate
 * "onboarding" visual style, so this reads as part of the same page
 * rather than a bolted-on tutorial widget.
 *
 * Location: features/about/StartStrip.tsx
 */
export function StartStrip() {
  return (
    <div className={styles.strip}>
      <ol className={styles.steps}>
        {startCopy.steps.map((step, i) => (
          <li key={step} className={styles.step}>
            <HudGridBullet seed={i} className={styles.glyph} />
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
