import styles from './HudGridBullet.module.css';

const COLS = 4;
const ROWS = 3;

/** A handful of hand-picked lit-cell patterns rather than anything
    randomized — this is a tiny, purely decorative SVG rendered at
    render time, and a seeded-random equivalent would risk a client/
    server hydration mismatch for zero real benefit over just picking a
    few patterns that already look intentional. Cycled by `seed %
    PATTERNS.length` so a repeated list (ManifestList rows, the
    applications/pillars lists on the About page) doesn't read as the
    same glyph copy-pasted down the page. */
const PATTERNS: number[][] = [
  [1, 6],
  [2, 5, 9],
  [0, 5, 10],
  [4, 6, 9],
  [1, 3, 8],
  [5, 7, 10],
];

interface HudGridBulletProps {
  /** Picks a pattern from PATTERNS — pass the row/item index so a list
      of these doesn't repeat the same glyph down the page. */
  seed?: number;
  className?: string;
}

/**
 * Small static LED-matrix glyph, styled after HUD Array's Alpha mode
 * (seed/sketches/hud-array.js's drawLedMatrix/drawMicroCluster) — reused
 * here as a bullet marker rather than a live sketch element, since a page
 * of these animating in the background would compete with the page's own
 * content rather than support it. Same 4-cols x 3-rows grid shape as that
 * sketch's own LED matrix calls, so anyone who's spent time with HUD
 * Array on the board recognizes where it's from.
 *
 * Purely decorative — aria-hidden, never the sole carrier of meaning
 * (every list item using this still has real text next to it).
 *
 * Location: components/ui/HudGridBullet.tsx
 */
export function HudGridBullet({ seed = 0, className }: HudGridBulletProps) {
  const lit = new Set(PATTERNS[Math.abs(seed) % PATTERNS.length]);
  const cell = 2.6;
  const gap = 1;
  const w = COLS * cell + (COLS - 1) * gap;
  const h = ROWS * cell + (ROWS - 1) * gap;

  return (
    <svg
      className={[styles.bullet, className].filter(Boolean).join(' ')}
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      aria-hidden="true"
      focusable="false"
    >
      {Array.from({ length: COLS * ROWS }, (_, i) => {
        const gx = i % COLS;
        const gy = Math.floor(i / COLS);
        return (
          <rect
            key={i}
            x={gx * (cell + gap)}
            y={gy * (cell + gap)}
            width={cell}
            height={cell}
            className={lit.has(i) ? styles.cellLit : styles.cellDim}
          />
        );
      })}
    </svg>
  );
}
