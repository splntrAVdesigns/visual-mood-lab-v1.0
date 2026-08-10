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
 * the "coded list" treatment for Capabilities and Roadmap. Only the
 * `live` status tag carries the accent colour; `building` and `planned`
 * stay dim so the one moving colour in the row stays meaningful.
 */
export function ManifestList({ rows }: ManifestListProps) {
  return (
    <dl className={styles.list}>
      {rows.map((row) => (
        <div key={row.key} className={styles.row}>
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
