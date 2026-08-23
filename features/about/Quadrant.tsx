import type { ReactNode } from 'react';
import { QuadrantMark } from '@/components/ui/QuadrantMark';
import { HudMicroCluster } from '@/components/ui/HudMicroCluster';
import styles from './Quadrant.module.css';

type QuadrantIndex = 0 | 1 | 2 | 3;

interface QuadrantProps {
  index: QuadrantIndex;
  eyebrow: string;
  heading: string;
  children: ReactNode;
}

/**
 * One quadrant panel of the About page grid. Every panel gets the same
 * animated HudMicroCluster next to its eyebrow line ("01 — Concept
 * [cluster]") — a header graphic that appears once per section, not a
 * per-list-item bullet (see ManifestList.tsx/QuadrantSection.tsx for
 * what those use instead). Rendered here, not passed in per usage, so
 * all four quadrants get it automatically and identically.
 */
export function Quadrant({ index, eyebrow, heading, children }: QuadrantProps) {
  return (
    <section className={styles.panel}>
      <header className={styles.header}>
        <QuadrantMark active={index} />
        <div>
          <p className={styles.eyebrow}>
            {eyebrow}
            <HudMicroCluster className={styles.eyebrowCluster} />
          </p>
          <h2 className={styles.heading}>{heading}</h2>
        </div>
      </header>
      <div className={styles.body}>{children}</div>
    </section>
  );
}
