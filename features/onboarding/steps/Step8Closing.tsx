import { STEP8 } from '../content';
import s from '../onboarding.module.css';

const GRID_IMAGES = [
  '/onboarding/card8/grid-0.jpg',
  '/onboarding/card8/grid-1.jpg',
  '/onboarding/card8/grid-2.jpg',
  '/onboarding/card8/grid-3.jpg',
  '/onboarding/card8/grid-4.jpg',
  '/onboarding/card8/grid-5.jpg',
];

export function Step8Closing() {
  return (
    <div className={s.body} style={{ paddingTop: 0 }}>
      <div className={s.gridLabel}>{STEP8.gridLabel}</div>
      <div className={s.grid}>
        {GRID_IMAGES.map((src, i) => (
          <div key={src} className={s.gridItem}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={src} alt={`Example tile made with Visual Mood Lab, ${i + 1} of 6`} />
          </div>
        ))}
      </div>

      <div className={s.wordmarkBlock} style={{ padding: '12px 0 8px 0' }}>
        <div className={s.wordmark}>
          <span className={s.wordmarkM}>Visual Mood</span> <span className={s.wordmarkL}>Lab</span>
        </div>
        <div className={s.tagline}>{STEP8.thanks}</div>
      </div>

      <hr className={s.sectionDivider} style={{ marginBottom: 10 }} />

      <div className={s.featLabel}>{STEP8.roadmapLabel}</div>
      {STEP8.roadmap.map((f) => (
        <div key={f.name} className={s.featItem} style={{ marginBottom: 6 }}>
          <span className={s.featDot} aria-hidden="true" />
          <div className={s.featText}>
            <b>{f.name}</b> <span>&mdash; {f.descDesktop}</span>
          </div>
        </div>
      ))}

      <p className={s.contactLead} style={{ marginTop: 12 }}>
        {STEP8.contactLead}
      </p>
      <div className={s.contactLinks}>
        {STEP8.links.map((link) => (
          <a
            key={link.href}
            href={link.href}
            target={link.href.startsWith('http') ? '_blank' : undefined}
            rel={link.href.startsWith('http') ? 'noopener noreferrer' : undefined}
          >
            {link.label}
          </a>
        ))}
      </div>
    </div>
  );
}
