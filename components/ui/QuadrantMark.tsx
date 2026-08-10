import type { CSSProperties } from 'react';
import styles from './QuadrantMark.module.css';

type QuadrantIndex = 0 | 1 | 2 | 3;

interface QuadrantMarkProps {
  /**
   * Which of the four squares (reading top-left, top-right, bottom-left,
   * bottom-right) is filled with the accent colour. Omit for an all-outline
   * mark — e.g. as a plain bullet glyph.
   */
  active?: QuadrantIndex;
  /**
   * Outline colour for the unfilled squares. 'neutral' (--border-hi) is the
   * default, used when the mark indexes a position (e.g. which quadrant of
   * the About page a panel is). 'accent' (--accent) is for standalone bullet
   * use, like the About nav-drawer entry, where the whole glyph should read
   * as a small cyan mark rather than point at a specific square.
   */
  tone?: 'neutral' | 'accent';
  /** Edge length of each square, in px. Defaults to 16. */
  size?: number;
  className?: string;
}

/**
 * The 2x2 square glyph used as a structural marker across the app — a
 * static echo of the hero's drifting blocks. Outline-only by default
 * (--border-hi); a single filled square indexes position, e.g. which
 * quadrant of a four-part layout this marker belongs to. Decorative only:
 * always aria-hidden, never the sole carrier of information.
 */
export function QuadrantMark({ active, tone = 'neutral', size = 16, className }: QuadrantMarkProps) {
  const style = { '--mark-size': `${size}px` } as CSSProperties;
  const outlineClass = tone === 'accent' ? styles.squareAccentOutline : styles.square;

  return (
    <span className={[styles.mark, className].filter(Boolean).join(' ')} style={style} aria-hidden="true">
      {([0, 1, 2, 3] as QuadrantIndex[]).map((i) => (
        <span key={i} className={i === active ? styles.squareActive : outlineClass} />
      ))}
    </span>
  );
}
