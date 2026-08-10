import type { ReactNode } from 'react';
import { QuadrantMark } from '@/components/ui/QuadrantMark';
import styles from './Quadrant.module.css';

type QuadrantIndex = 0 | 1 | 2 | 3;

interface QuadrantProps {
  index: QuadrantIndex;
  eyebrow: string;
  heading: string;
  children: ReactNode;
}

export function Quadrant({ index, eyebrow, heading, children }: QuadrantProps) {
  return (
    <section className={styles.panel}>
      <header className={styles.header}>
        <QuadrantMark active={index} />
        <div>
          <p className={styles.eyebrow}>{eyebrow}</p>
          <h2 className={styles.heading}>{heading}</h2>
        </div>
      </header>
      <div className={styles.body}>{children}</div>
    </section>
  );
}
