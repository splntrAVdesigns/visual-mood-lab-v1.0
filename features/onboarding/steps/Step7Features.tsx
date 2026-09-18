import { STEP7 } from '../content';
import s from '../onboarding.module.css';

export function Step7Features() {
  return (
    <div className={s.body} style={{ paddingTop: 0 }}>
      <div className={s.wordmarkBlock} style={{ padding: '16px 0 24px 0' }}>
        <div className={s.wordmark}>
          <span className={s.wordmarkM}>Visual Mood</span> <span className={s.wordmarkL}>Lab</span>
        </div>
        <div className={s.tagline}>{STEP7.tagline}</div>
      </div>

      <hr className={s.sectionDivider} />

      <div className={s.featLabel}>{STEP7.sectionLabel}</div>
      {STEP7.features.map((f) => (
        <div key={f.name} className={s.featItem}>
          <span className={s.featDot} aria-hidden="true" />
          <div className={s.featText}>
            <b>{f.name}</b>
            {f.isNew && <span className={s.newTag}>New</span>} <span>&mdash; {f.descDesktop}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
