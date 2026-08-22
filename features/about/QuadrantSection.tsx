import { HudGridBullet } from '@/components/ui/HudGridBullet';
import { Quadrant } from './Quadrant';
import { ManifestList } from './ManifestList';
import { conceptCopy, capabilitiesCopy, roadmapCopy, brandCopy } from './content';
import styles from './QuadrantSection.module.css';

export function QuadrantSection() {
  return (
    <div className={styles.grid}>
      <Quadrant index={0} eyebrow={conceptCopy.eyebrow} heading={conceptCopy.heading}>
        {conceptCopy.paragraphs.map((paragraph) => (
          <p key={paragraph.slice(0, 24)}>{paragraph}</p>
        ))}
        <ul className={styles.bulletList}>
          {conceptCopy.applications.map((item, i) => (
            <li key={item.slice(0, 24)} className={styles.bulletRow}>
              <HudGridBullet seed={i} className={styles.bulletGlyph} />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </Quadrant>

      <Quadrant index={1} eyebrow={capabilitiesCopy.eyebrow} heading={capabilitiesCopy.heading}>
        <ManifestList rows={capabilitiesCopy.rows} />
      </Quadrant>

      <Quadrant index={2} eyebrow={roadmapCopy.eyebrow} heading={roadmapCopy.heading}>
        <ManifestList rows={roadmapCopy.rows} />
      </Quadrant>

      <Quadrant index={3} eyebrow={brandCopy.eyebrow} heading={brandCopy.heading}>
        {brandCopy.paragraphs.map((paragraph) => (
          <p key={paragraph.slice(0, 24)}>{paragraph}</p>
        ))}
        <ul className={styles.bulletList}>
          {brandCopy.pillars.map((item, i) => (
            <li key={item.slice(0, 24)} className={styles.bulletRow}>
              <HudGridBullet seed={i} className={styles.bulletGlyph} />
              <span>{item}</span>
            </li>
          ))}
        </ul>
        <div className={styles.brandLinks}>
          <a className={styles.brandLink} href={brandCopy.linkHref} target="_blank" rel="noreferrer">
            {brandCopy.linkLabel} ↗
          </a>
          <a className={styles.brandLink} href={brandCopy.instagramHref} target="_blank" rel="noreferrer">
            {brandCopy.instagramLabel} ↗
          </a>
        </div>
        <p className={styles.feedbackLine}>
          Want to provide feedback? Go to:{' '}
          <a className={styles.brandLink} href={`mailto:${brandCopy.feedbackEmail}`}>
            {brandCopy.feedbackEmail}
          </a>
        </p>
      </Quadrant>
    </div>
  );
}
