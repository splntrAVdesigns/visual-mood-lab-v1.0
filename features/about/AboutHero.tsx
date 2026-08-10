import { aboutHero } from './content';
import styles from './AboutHero.module.css';

/**
 * Ambient ractangles behind the hero copy — a quieter echo of the board
 * hero's drifting blocks, not a re-implementation of it. Pure CSS,
 * `prefers-reduced-motion` disables the drift entirely (see module.css).
 */
function DriftingBlocks() {
  return (
    <div className={styles.blocks} aria-hidden="true">
      <span className={`${styles.block} ${styles.blockA}`} />
      <span className={`${styles.block} ${styles.blockB}`} />
      <span className={`${styles.block} ${styles.blockAccent}`} />
      <span className={`${styles.block} ${styles.blockC}`} />
    </div>
  );
}

export function AboutHero() {
  return (
    <section className={styles.hero}>
      <DriftingBlocks />
      <div className={styles.content}>
        <p className={styles.eyebrow}>{aboutHero.eyebrow}</p>
        <h1 className={styles.title}>{aboutHero.title}</h1>
        <p className={styles.body}>{aboutHero.body}</p>
      </div>
    </section>
  );
}
