import { HudGridBullet } from '@/components/ui/HudGridBullet';
import type { ManifestRow } from './content';
import styles from './ManifestList.module.css';

const STATUS_LABEL: Record<ManifestRow['status'], string> = {
  live: 'live',
  building: 'building',
  planned: 'planned',
};

interface ManifestListProps {
  rows: ManifestRow[];
}

/**
 * Renders a set of ManifestRow entries as a mono key/value manifest —
 * the "coded list" treatment for Capabilities and Roadmap. Each row leads
 * with a small HudGridBullet glyph (styled after HUD Array's Alpha-mode
 * LED matrix) rather than a plain dash or dot, seeded by row position so
 * a long list doesn't read as the same glyph repeated down the page.
 * Only the `live` status tag carries the accent colour; `building` and
 * `planned` stay dim so the one moving colour in the row stays
 * meaningful.
 */
export function ManifestList({ rows }: ManifestListProps) {
  return (
    <dl className={styles.list}>
      {rows.map((row, index) => (
        <div key={row.key} className={styles.row}>
          <HudGridBullet seed={index} className={styles.bullet} />
          <dt className={styles.key}>{row.key}</dt>
          <dd className={styles.detail}>{row.detail}</dd>
          <span className={`${styles.status} ${row.status === 'live' ? styles.statusLive : ''}`}>
            [{STATUS_LABEL[row.status]}]
          </span>
        </div>
      ))}
    </dl>
  );
}
